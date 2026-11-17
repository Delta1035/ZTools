import { useRecorderStore } from './store'
import { pauseRecordTimer, resumeRecordTimer, startRecordTimer, stopRecordTimer } from './timer'
import { recorderRuntime } from './runtime'
import type { AudioSource, CaptureSource, RecorderState } from './types'

const RECORD_TIMESLICE_MS = 5000

let mediaRecorder: MediaRecorder | null = null
let currentStream: MediaStream | null = null
let pendingWrites: Promise<void> = Promise.resolve()
let stopPromise: Promise<string | null> | null = null
let finalizePromise: Promise<string | null> | null = null
let pendingWriteError: unknown = null

type RecorderStore = ReturnType<typeof useRecorderStore>

/**
 * 查询当前可录制的屏幕和窗口源。
 * @returns 经 ZTools 主进程采集并过滤后的捕获源数组。
 * @throws 宿主 API 不可用或桌面捕获失败时抛出原始错误。
 */
export async function getCaptureSources(): Promise<CaptureSource[]> {
  return recorderRuntime.capture.listSources()
}

/**
 * 为指定捕获源创建视频和可选音频轨道。
 * @param source 屏幕或窗口捕获源。
 * @param audioSources 需要合并的音频来源。
 * @returns 可交给 MediaRecorder 的媒体流。
 * @throws 浏览器拒绝桌面或麦克风权限时抛出原始错误。
 */
export async function createCaptureStream(
  source: CaptureSource,
  audioSources: AudioSource[]
): Promise<MediaStream> {
  const nextStream = await recorderRuntime.capture.createStream(source, {
    microphone: audioSources.includes('mic'),
    systemAudio: audioSources.includes('system')
  })
  // 新流创建成功后再释放旧流，避免切换失败时预览和录制同时中断。
  stopCurrentStream()
  currentStream = nextStream
  return currentStream
}

/**
 * 返回当前预览或录制使用的媒体流。
 * @returns 当前媒体流，没有已创建流时返回 null。
 */
export function getCurrentStream(): MediaStream | null {
  return currentStream
}

/**
 * 启动 MediaRecorder，并将数据分段写入当前视频文件。
 * @param store 录屏状态仓库。
 * @returns 无返回值。
 * @throws 当前流无视频轨道或浏览器不支持录制时抛出错误。
 */
export function startRecording(store: RecorderStore): void {
  if (finalizePromise) throw new Error('上一段录制正在清理，请稍后重试')
  if (mediaRecorder) {
    if (mediaRecorder.state === 'inactive') throw new Error('上一段录制尚未完成清理')
    return
  }
  if (!currentStream) return
  const videoTrack = currentStream.getVideoTracks()[0]
  if (!videoTrack || videoTrack.readyState === 'ended') {
    throw new Error('录制源已结束，请刷新录制源后重试')
  }

  const mimeType = selectMimeType()
  mediaRecorder = mimeType
    ? new MediaRecorder(currentStream, { mimeType })
    : new MediaRecorder(currentStream)
  pendingWrites = Promise.resolve()
  pendingWriteError = null

  // 先创建目标文件，再接收数据块，保证录制过程中不会丢失前置数据。
  recorderRuntime.files.create()
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    pendingWrites = pendingWrites
      .then(async () => {
        const buffer = await event.data.arrayBuffer()
        recorderRuntime.files.append(new Uint8Array(buffer))
      })
      .catch((error: unknown) => {
        pendingWriteError = error
        store.errorText = error instanceof Error ? error.message : String(error)
      })
  }
  mediaRecorder.onstart = () => {
    store.recorderState = 'recording'
    startRecordTimer()
  }
  mediaRecorder.onpause = () => {
    store.recorderState = 'paused'
    pauseRecordTimer()
  }
  mediaRecorder.onresume = () => {
    store.recorderState = 'recording'
    resumeRecordTimer()
  }
  mediaRecorder.onerror = () => {
    store.errorText = '录屏过程中发生错误'
    const recorder = mediaRecorder
    if (recorder && recorder.state !== 'inactive') {
      // 让 onstop 统一完成尾部写入和资源释放，避免错误路径遗留活动流。
      try {
        recorder.stop()
        return
      } catch {
        // stop 失败时继续执行兜底清理。
      }
    }
    void finalizeRecording(store).catch(() => undefined)
  }
  mediaRecorder.onstop = () => {
    if (!stopPromise) {
      void finalizeRecording(store).catch((error: unknown) => {
        store.errorText = error instanceof Error ? error.message : String(error)
      })
    }
  }

  try {
    mediaRecorder.start(RECORD_TIMESLICE_MS)
  } catch (error) {
    recorderRuntime.files.close()
    mediaRecorder = null
    throw error
  }
}

/**
 * 停止当前录制并等待最后一个数据块写入磁盘。
 * @param store 录屏状态仓库。
 * @returns 已保存文件路径；没有活动录制时返回 null。
 */
export function stopRecording(store: RecorderStore): Promise<string | null> {
  if (finalizePromise) return finalizePromise
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return recorderRuntime.files.getCurrentPath() ? finalizeRecording(store) : Promise.resolve(null)
  }
  if (stopPromise) return stopPromise

  const recorder = mediaRecorder
  stopPromise = new Promise<string | null>((resolve) => {
    if (recorder) {
      recorder.onstop = () => {
        void finalizeRecording(store)
          .then(resolve)
          .catch((error: unknown) => {
            store.errorText = error instanceof Error ? error.message : String(error)
            resolve(null)
          })
      }
      recorder.stop()
    } else {
      resolve(null)
    }
  }).finally(() => {
    stopPromise = null
  })
  return stopPromise
}

/**
 * 暂停当前录制。
 * @returns 无返回值。
 */
export function pauseRecording(): void {
  if (mediaRecorder?.state === 'recording') mediaRecorder.pause()
}

/**
 * 恢复当前录制。
 * @returns 无返回值。
 */
export function resumeRecording(): void {
  if (mediaRecorder?.state === 'paused') mediaRecorder.resume()
}

/**
 * 在暂停和录制状态之间切换。
 * @returns 无返回值。
 */
export function toggleRecordingPause(): void {
  if (mediaRecorder?.state === 'recording') pauseRecording()
  else if (mediaRecorder?.state === 'paused') resumeRecording()
}

/**
 * 获取当前录制器状态。
 * @returns 当前 MediaRecorder 状态。
 */
export function getRecorderState(): RecorderState {
  return mediaRecorder?.state === 'recording' || mediaRecorder?.state === 'paused'
    ? mediaRecorder.state
    : 'inactive'
}

/**
 * 释放预览或录制流中的所有轨道。
 * @returns 无返回值。
 */
export function stopCurrentStream(): void {
  currentStream?.getTracks().forEach((track) => track.stop())
  currentStream = null
}

/**
 * 销毁录制控制器并等待当前文件完成收尾。
 * @param store 录屏状态仓库。
 * @returns 资源释放完成后的 Promise。
 */
export async function disposeRecorder(store: RecorderStore): Promise<void> {
  // 先停止 recorder，确保最后一个 dataavailable 事件进入收尾流程。
  await stopRecording(store)
  stopCurrentStream()
}

/**
 * 选择当前 Chromium 支持的 WebM 编码格式。
 * @returns 可用 MIME 类型；全部不支持时返回空字符串。
 */
function selectMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ''
}

/**
 * 完成录制收尾并释放媒体资源。
 * @param store 录屏状态仓库。
 * @returns 保存路径；没有当前文件时返回 null。
 */
async function finalizeRecording(store: RecorderStore): Promise<string | null> {
  if (finalizePromise) return finalizePromise
  if (!mediaRecorder && !recorderRuntime.files.getCurrentPath()) return null

  finalizePromise = (async (): Promise<string | null> => {
    store.recorderState = 'inactive'
    stopRecordTimer()

    // 等待所有 dataavailable 任务按顺序写入，防止尾部数据丢失。
    await pendingWrites
    const filePath = recorderRuntime.files.getCurrentPath()
    recorderRuntime.files.close()
    mediaRecorder = null
    stopCurrentStream()
    if (filePath) {
      recorderRuntime.files.addRecent({ filepath: filePath })
      store.savedFilePath = filePath
    }
    recorderRuntime.shell.beep()
    if (pendingWriteError) throw pendingWriteError
    return filePath
  })()

  try {
    return await finalizePromise
  } finally {
    finalizePromise = null
    pendingWriteError = null
  }
}
