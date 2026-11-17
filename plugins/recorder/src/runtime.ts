import type { CaptureSource, PluginEnterPayload, RecorderRuntime } from './types'

/**
 * 创建录屏插件使用的 ZTools 运行时适配器。
 * @returns 隔离宿主 API 的录屏运行时。
 * @throws 宿主缺少必要 API 或 FFmpeg 转换失败时抛出错误。
 */
export function createRecorderRuntime(): RecorderRuntime {
  const ztools = window.ztools
  const os = ztools.isWindows() ? 'windows' : ztools.isLinux() ? 'linux' : 'macos'
  const capabilities = {
    systemAudio: os === 'windows',
    microphone: true,
    desktopCapture: true,
    // FFmpeg 的可用性由宿主在首次执行转换时确认。
    ffmpeg: true
  }

  return {
    platform: { os, capabilities },
    capture: {
      listSources: async (): Promise<CaptureSource[]> => {
        const sources = await ztools.desktopCaptureSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: true
        })
        return sources
          .filter((source) => source.name !== 'ZTools' && source.name !== 'uTools')
          .map((source) => ({
            ...source,
            appIconURL: source.appIcon?.toDataURL?.() || source.appIconURL
          }))
      },
      createStream: async (source, options): Promise<MediaStream> => {
        if (!capabilities.desktopCapture) throw new Error('当前平台不支持桌面捕获')
        if (options.systemAudio && !capabilities.systemAudio) {
          throw new Error('当前平台不支持系统声音录制')
        }

        const audioConstraint: boolean | MediaTrackConstraints = options.systemAudio
          ? ({ mandatory: { chromeMediaSource: 'desktop' } } as unknown as MediaTrackConstraints)
          : false
        const videoStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id
            }
          } as MediaTrackConstraints
        })

        try {
          const tracks = [...videoStream.getVideoTracks(), ...videoStream.getAudioTracks()]
          if (options.microphone) {
            if (!capabilities.microphone) throw new Error('当前平台不支持麦克风录制')
            // 麦克风需要单独申请权限，再合并到桌面捕获流。
            const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            tracks.push(...microphoneStream.getAudioTracks())
          }
          return new MediaStream(tracks)
        } catch (error) {
          // 创建附加音轨失败时释放已经申请到的桌面捕获资源。
          videoStream.getTracks().forEach((track) => track.stop())
          throw error
        }
      }
    },
    files: {
      create: () => window.mediaFile.newFile(),
      append: (data) => window.mediaFile.appendData(data),
      close: () => window.mediaFile.close(),
      getCurrentPath: () => window.mediaFile.getCurrentPath(),
      getOutputDir: () => window.mediaFile.getOutputDir(),
      setOutputDir: (directory) => window.mediaFile.setOutputDir(directory),
      getRecent: () => window.mediaFile.getRecentFiles(),
      addRecent: (file) => window.mediaFile.addRecentFile(file)
    },
    dialogs: {
      showOpenDialog: (options) => ztools.showOpenDialog(options)
    },
    conversion: {
      convert: async (inputPath, format): Promise<string> => {
        if (format === 'webm') return inputPath
        const extension = format === 'mp4' ? 'mp4' : 'gif'
        const outputPath = buildOutputPath(inputPath, extension)
        const args =
          format === 'mp4'
            ? [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                inputPath,
                '-map',
                '0:v:0',
                '-map',
                '0:a?',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '23',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-movflags',
                '+faststart',
                '-y',
                outputPath
              ]
            : [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                inputPath,
                '-vf',
                'fps=1',
                '-y',
                outputPath
              ]
        await ztools.runFFmpeg(args)
        return outputPath
      }
    },
    storage: {
      get: <T>(key: string): T | null => {
        const raw = ztools.dbStorage.getItem(key)
        if (raw === null) return null
        try {
          return JSON.parse(raw) as T
        } catch {
          return raw as T
        }
      },
      set: <T>(key: string, value: T): void => {
        ztools.dbStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
    },
    lifecycle: {
      onEnter: async (callback: (payload: PluginEnterPayload) => void): Promise<void> => {
        await ztools.onPluginEnter(callback)
      },
      hideMainWindow: async (): Promise<void> => {
        await ztools.hideMainWindow()
      },
      showMainWindow: (): boolean => ztools.showMainWindow(),
      setSubInput: async (placeholder: string): Promise<void> => {
        await ztools.setSubInput(null, placeholder, false)
      }
    },
    shell: {
      openPath: (fullPath) => ztools.shellOpenPath(fullPath),
      showItemInFolder: (fullPath) => ztools.shellShowItemInFolder(fullPath),
      beep: () => ztools.shellBeep(),
      showToast: async (message): Promise<void> => {
        await ztools.showToast(message)
      }
    }
  }
}

/**
 * 根据录制文件路径生成不覆盖原文件的转换路径。
 * @param inputPath 输入文件路径。
 * @param extension 目标扩展名，不含点号。
 * @returns 目标文件路径。
 */
function buildOutputPath(inputPath: string, extension: string): string {
  const lastSlash = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'))
  const lastDot = inputPath.lastIndexOf('.')
  const baseEnd = lastDot > lastSlash ? lastDot : inputPath.length
  return `${inputPath.slice(0, baseEnd)}.${extension}`
}

export const recorderRuntime = createRecorderRuntime()
