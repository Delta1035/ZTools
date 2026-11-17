<template>
  <main class="recorder-app">
    <a-alert
      v-if="store.errorText"
      type="error"
      banner
      closable
      :message="store.errorText"
      @close="store.errorText = ''"
    />
    <a-alert v-if="isRecording || countdown > 0" type="info" :message="statusText" />
    <a-spin :spinning="store.loading" tip="格式转换中...">
      <section class="toolbar-row">
        <div class="toolbar-main">
          <a-button-group>
            <a-tooltip placement="bottom" title="开始或停止">
              <a-button
                id="switchBtn"
                type="primary"
                danger
                :disabled="store.disableOperation || store.loading"
                @click="onRecordClick"
              >
                <template #icon><VideoCameraOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip placement="bottom" title="暂停或恢复">
              <a-button :disabled="!isRecording || store.loading" @click="togglePause">
                <template #icon>
                  <PlayCircleOutlined v-if="store.recorderState === 'paused'" />
                  <PauseCircleOutlined v-else />
                </template>
              </a-button>
            </a-tooltip>
          </a-button-group>

          <a-tooltip placement="bottom" title="快捷键开始不受此影响，0 秒不延迟">
            <span class="delay-control">
              延迟
              <a-input-number
                id="inputDelay"
                v-model:value="store.delayStart"
                :min="0"
                :max="10"
                :disabled="isRecording || store.disableOperation || store.loading"
                @change="saveDelay"
              />
            </span>
          </a-tooltip>

          <a-button-group class="source-controls">
            <a-tooltip placement="bottom" title="选择录制窗口（新建或关闭窗口需刷新）">
              <a-select
                id="source"
                v-model:value="store.selectedVideoSource"
                :options="store.videoOptions"
                :disabled="isRecording || store.disableOperation || store.loading"
                placeholder="选择录制窗口"
                @change="onSourceChange"
              >
                <template #option="{ label, icon }">
                  <img v-if="icon" class="source-icon" :src="icon" alt="" />
                  <DesktopOutlined v-else class="source-icon-fallback" />
                  {{ label }}
                </template>
              </a-select>
            </a-tooltip>
            <a-tooltip placement="bottom" title="刷新可选择窗口列表">
              <a-button
                type="primary"
                aria-label="刷新录制源"
                :disabled="isRecording || store.disableOperation || store.loading"
                @click="refreshSources"
              >
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </a-tooltip>
          </a-button-group>

          <a-button-group class="audio-controls">
            <a-tooltip
              placement="bottom"
              :title="supportsSystemAudio ? '系统声音' : '当前平台不支持系统声音'"
            >
              <a-button
                :type="store.hasSystemAudio ? 'primary' : 'default'"
                :disabled="
                  !supportsSystemAudio || isRecording || store.disableOperation || store.loading
                "
                @click="toggleSystemAudio(!store.hasSystemAudio)"
              >
                系统声
              </a-button>
            </a-tooltip>
            <a-tooltip placement="bottom" title="主麦克风声音">
              <a-button
                :type="store.hasMicrophoneAudio ? 'primary' : 'default'"
                :disabled="isRecording || store.disableOperation || store.loading"
                @click="toggleMicrophone(!store.hasMicrophoneAudio)"
              >
                麦克风
              </a-button>
            </a-tooltip>
          </a-button-group>
        </div>

        <a-button-group>
          <a-tooltip placement="bottom" title="打开录像目录">
            <a-button aria-label="打开录像目录" @click="openOutputDir">
              <template #icon><FolderOpenOutlined /></template>
            </a-button>
          </a-tooltip>
          <a-tooltip placement="bottom" title="设置">
            <a-button
              aria-label="录屏设置"
              :disabled="isRecording || store.disableOperation || store.loading"
              @click="store.settingVisible = true"
            >
              <template #icon><SettingOutlined /></template>
            </a-button>
          </a-tooltip>
        </a-button-group>
      </section>

      <div class="toolbar-divider"></div>
      <div class="preview-shell">
        <video id="video" ref="preview" muted autoplay playsinline></video>
        <div v-if="!store.selectedVideoSource" class="preview-empty">正在等待可用的录制源…</div>
        <div v-if="countdown > 0" class="preview-overlay">{{ countdown }} 秒后开始录制</div>
      </div>
      <div class="preview-footer">
        <span>{{ platformLabel }} · 保存为 {{ store.outputFormat.toUpperCase() }}</span>
        <span class="footer-path" :title="store.outputDir">{{ store.outputDir }}</span>
      </div>
    </a-spin>
    <Setting />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  DesktopOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  VideoCameraOutlined
} from '@ant-design/icons-vue'
import Setting from './components/Setting.vue'
import { useRecorderStore } from './store'
import {
  createCaptureStream,
  getCaptureSources,
  getCurrentStream,
  getRecorderState,
  disposeRecorder,
  startRecording,
  stopRecording,
  toggleRecordingPause
} from './recorder'
import { cancelCountdown, recordedTime, runCountdown } from './timer'
import { convertRecording } from './convert'
import { recorderRuntime } from './runtime'
import type { AudioSource, PluginEnterPayload } from './types'

const store = useRecorderStore()
const preview = ref<HTMLVideoElement | null>(null)
const countdown = ref(0)
const lastPreviewedSource = ref('')
const supportsSystemAudio = computed(() => recorderRuntime.platform.capabilities.systemAudio)
const isRecording = computed(() => store.recorderState !== 'inactive')
const platformLabel = computed(() =>
  recorderRuntime.platform.os === 'linux'
    ? 'LINUX'
    : recorderRuntime.platform.os === 'windows'
      ? 'WINDOWS'
      : 'MACOS'
)
const statusText = computed(() => {
  if (countdown.value > 0) return '准备开始'
  if (store.recorderState === 'recording') return `录制中 ${recordedTime.value}`
  if (store.recorderState === 'paused') return `已暂停 ${recordedTime.value}`
  return '未录制'
})

/**
 * 从 ZTools 持久化存储加载录屏设置。
 * @returns 无返回值。
 */
function loadSettings(): void {
  const savedDelay = recorderRuntime.storage.get<unknown>('delayStart')
  if (
    typeof savedDelay === 'number' &&
    Number.isFinite(savedDelay) &&
    savedDelay >= 0 &&
    savedDelay <= 10
  ) {
    store.delayStart = savedDelay
  }

  const savedAudio = recorderRuntime.storage.get<unknown>('audioSource')
  if (Array.isArray(savedAudio)) {
    store.audioSources = savedAudio.filter(
      (item): item is AudioSource => item === 'system' || item === 'mic'
    )
  } else if (supportsSystemAudio.value) {
    // 保持目标插件的行为：Windows 首次运行默认录制系统声音。
    store.audioSources = ['system']
  }
  if (!supportsSystemAudio.value) {
    store.audioSources = store.audioSources.filter((item) => item !== 'system')
  }
  store.outputDir = recorderRuntime.files.getOutputDir()
  const savedFormat = recorderRuntime.storage.get<unknown>('outfileFormat')
  if (savedFormat === 'webm' || savedFormat === 'mp4' || savedFormat === 'gif') {
    store.outputFormat = savedFormat
  }
}

/**
 * 刷新屏幕和窗口捕获源，并预览默认源。
 * @returns 刷新完成后的 Promise。
 */
async function refreshSources(): Promise<void> {
  try {
    const sources = await getCaptureSources()
    store.videoSources = sources
    if (!sources.length) throw new Error('没有找到可录制的屏幕或窗口')
    if (!sources.some((source) => source.id === store.selectedVideoSource)) {
      store.selectedVideoSource =
        sources.find((source) => source.id.startsWith('screen:'))?.id || sources[0].id
    }
    await previewSource(store.selectedVideoSource)
    lastPreviewedSource.value = store.selectedVideoSource
  } catch (error) {
    store.errorText = error instanceof Error ? error.message : String(error)
  }
}

/**
 * 创建指定源的预览媒体流。
 * @param sourceId 屏幕或窗口源 ID。
 * @param audioSources 需要申请的音频源；省略时使用当前设置。
 * @returns 预览完成后的 Promise。
 */
async function previewSource(sourceId: string, audioSources = store.audioSources): Promise<void> {
  const source = store.videoSources.find((item) => item.id === sourceId)
  if (!source) return
  const stream = await createCaptureStream(source, audioSources)
  if (preview.value) {
    preview.value.srcObject = stream
    await preview.value.play().catch(() => undefined)
  }
}

/**
 * 处理录制源下拉选择变化。
 * @param sourceId 新选择的录制源 ID。
 * @returns 预览更新完成后的 Promise。
 */
async function onSourceChange(sourceId: string): Promise<void> {
  const previousSource = lastPreviewedSource.value
  try {
    await previewSource(sourceId)
    lastPreviewedSource.value = sourceId
  } catch (error) {
    // 目标流创建失败时保留旧流和旧选择，避免界面指向不可用源。
    if (previousSource) store.selectedVideoSource = previousSource
    store.errorText = error instanceof Error ? error.message : String(error)
  }
}

/**
 * 按当前设置开始或停止录制。
 * @returns 录制操作完成后的 Promise。
 */
async function onRecordClick(): Promise<void> {
  if (getRecorderState() !== 'inactive') {
    await finishRecording()
    return
  }

  try {
    store.errorText = ''
    store.disableOperation = true
    if (!getCurrentStream()) await refreshSources()
    await runCountdown(store.delayStart, (remaining) => {
      countdown.value = remaining
    })
    countdown.value = 0
    if (!getCurrentStream()) throw new Error('没有可用的录制源')
    startRecording(store)
    await recorderRuntime.lifecycle.hideMainWindow()
  } catch (error) {
    store.errorText = error instanceof Error ? error.message : String(error)
    countdown.value = 0
  } finally {
    store.disableOperation = false
  }
}

/**
 * 停止录制并按用户设置转换输出格式。
 * @returns 录制收尾完成后的 Promise。
 */
async function finishRecording(): Promise<void> {
  cancelCountdown()
  countdown.value = 0
  const filePath = await stopRecording(store)
  if (!filePath) return

  store.loading = store.outputFormat !== 'webm'
  try {
    const outputPath = await convertRecording(filePath, store.outputFormat)
    recorderRuntime.shell.showItemInFolder(outputPath)
    await recorderRuntime.shell.showToast(`录屏已保存：${outputPath}`)
  } catch (error) {
    store.errorText = error instanceof Error ? error.message : String(error)
  } finally {
    store.loading = false
  }
}

/**
 * 切换录制暂停状态。
 * @returns 无返回值。
 */
function togglePause(): void {
  toggleRecordingPause()
}

/**
 * 使用系统文件管理器打开录制输出目录。
 * @returns 无返回值。
 */
function openOutputDir(): void {
  recorderRuntime.shell.openPath(recorderRuntime.files.getOutputDir())
}

/**
 * 切换麦克风录音，并重新创建预览流。
 * @param enabled 是否启用麦克风。
 * @returns 预览更新完成后的 Promise。
 */
async function toggleMicrophone(enabled: boolean): Promise<void> {
  await updateAudioSource('mic', enabled)
}

/**
 * 切换系统声音录音，并重新创建预览流。
 * @param enabled 是否启用系统声音。
 * @returns 预览更新完成后的 Promise。
 */
async function toggleSystemAudio(enabled: boolean): Promise<void> {
  if (!supportsSystemAudio.value) return
  await updateAudioSource('system', enabled)
}

/**
 * 更新一种音频源的启用状态并持久化。
 * @param source 需要更新的音频源。
 * @param enabled 是否启用。
 * @returns 预览更新完成后的 Promise。
 */
async function updateAudioSource(source: AudioSource, enabled: boolean): Promise<void> {
  const next = store.audioSources.filter((item) => item !== source)
  if (enabled) next.push(source)
  if (store.selectedVideoSource) {
    try {
      await previewSource(store.selectedVideoSource, next)
    } catch (error) {
      store.errorText = error instanceof Error ? error.message : String(error)
      return
    }
  }
  store.audioSources = next
  recorderRuntime.storage.set('audioSource', next)
  if (!store.selectedVideoSource) store.audioSources = next
}

/**
 * 保存开始录制前的延迟秒数。
 * @param value 新的延迟秒数。
 * @returns 无返回值。
 */
function saveDelay(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  recorderRuntime.storage.set('delayStart', value)
}

/**
 * 响应 ZTools 插件功能进入事件。
 * @param payload 插件功能进入参数。
 * @returns 操作完成后的 Promise。
 */
async function onPluginEnter(payload: PluginEnterPayload): Promise<void> {
  if (payload.code === 'start-recording') await onRecordClick()
  else if (payload.code === 'stop-recording') await finishRecording()
  else if (payload.code === 'toggle-pause') togglePause()
}

onMounted(async () => {
  loadSettings()
  await recorderRuntime.lifecycle.setSubInput('可绑定“开始录屏”“停止录屏”“暂停恢复录屏”')
  await recorderRuntime.lifecycle.onEnter(onPluginEnter)
  await refreshSources()
})

onBeforeUnmount(() => {
  cancelCountdown()
  void disposeRecorder(store)
})
</script>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  color: #1f1f1f;
  background: #fff;
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.recorder-app {
  min-height: 100vh;
  padding: 0 16px;
}

.toolbar-row,
.toolbar-main,
.preview-footer {
  display: flex;
  align-items: center;
}

.toolbar-row,
.preview-footer {
  justify-content: space-between;
}

.toolbar-row {
  min-height: 64px;
  gap: 12px;
  padding: 12px 0;
}

.toolbar-main {
  min-width: 0;
  flex-wrap: wrap;
  gap: 12px;
}

.delay-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.delay-control :deep(.ant-input-number) {
  width: 70px;
}

.source-controls {
  display: inline-flex;
  min-width: 0;
}

.source-controls :deep(.ant-select) {
  width: min(320px, 35vw);
  min-width: 160px;
}

.audio-controls {
  align-self: flex-end;
}

.source-icon {
  width: 24px;
  height: 24px;
  margin-right: 6px;
  object-fit: contain;
  vertical-align: middle;
}

.source-icon-fallback {
  width: 24px;
  height: 24px;
  margin-right: 6px;
  vertical-align: middle;
}

.toolbar-divider {
  margin-bottom: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.preview-shell {
  position: relative;
  min-height: 230px;
  overflow: hidden;
  background: #171717;
}

video {
  display: block;
  width: 100%;
  min-height: 230px;
  object-fit: contain;
}

.preview-empty,
.preview-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #d9d9d9;
  font-size: 14px;
}

.preview-overlay {
  background: rgba(0, 0, 0, 0.55);
  font-size: 28px;
  font-weight: 600;
}

.preview-footer {
  gap: 10px;
  padding: 10px 0 4px;
  color: #8c8c8c;
  font-size: 12px;
}

.footer-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .toolbar-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .toolbar-main {
    width: 100%;
  }

  .source-controls {
    flex: 1;
  }

  .source-controls :deep(.ant-select) {
    width: 100%;
  }
}
</style>
