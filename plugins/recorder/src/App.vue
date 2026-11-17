<template>
  <div class="px-4">
    <a-alert
      v-if="store.errorText?.length"
      type="error"
      :message="store.errorText"
      banner
      closable
      @close="store.errorText = ''"
    />
    <a-alert v-if="infoText?.length" :message="infoText" type="info" />
    <a-spin tip="格式转换中..." size="large" :spinning="store.loading">
      <div class="py-4 flex justify-space-between">
        <div class="flex">
          <a-button-group>
            <a-tooltip placement="bottom" title="开始或停止">
              <a-button
                id="switchBtn"
                :disabled="store.disableOperation || store.loading"
                @click="onRecordClick"
              >
                <template #icon>
                  <RecordIcon v-if="store.recorderState == 'inactive'" />
                  <StopIcon v-else />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip placement="bottom" title="暂停或恢复">
              <a-button
                :disabled="store.recorderState == 'inactive' || store.loading"
                @click="togglePause"
              >
                <template #icon>
                  <PlayIcon v-if="store.recorderState == 'paused'" />
                  <PauseIcon v-else />
                </template>
              </a-button>
            </a-tooltip>
          </a-button-group>
          <a-tooltip class="ml-3" placement="bottom" title="快捷键开始不受此影响 0s不延迟">
            延迟
            <a-input-number
              id="inputDelay"
              v-model:value="store.delayStart"
              class="width-4"
              :min="0"
              :max="10"
              :disabled="
                store.recorderState != 'inactive' || store.disableOperation || store.loading
              "
              @change="saveDelay"
            />
          </a-tooltip>
          <a-button-group>
            <a-tooltip placement="bottom" title="选择录制窗口(新建或关闭窗口需刷新)">
              <a-select
                v-model:value="store.selectedVideoSource"
                class="ml-3 width-20"
                :disabled="
                  store.recorderState != 'inactive' || store.disableOperation || store.loading
                "
                :options="store.videoOptions"
                @change="onSourceChange"
              >
                <template #option="{ label, icon }">
                  <a-image v-if="icon" :width="24" :height="24" :src="icon"></a-image>
                  <DesktopOutlined v-else style="width: 24px; height: 24px; font-size: 22px" />
                  {{ label }}
                </template>
              </a-select>
            </a-tooltip>
            <a-tooltip placement="bottom" title="刷新可选择窗口列表">
              <a-button
                type="primary"
                :disabled="
                  store.recorderState != 'inactive' || store.disableOperation || store.loading
                "
                @click="refreshSources"
              >
                <template #icon>
                  <SyncOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-button-group>
          <div class="ml-3 self-end">
            <a-button-group>
              <a-tooltip placement="bottom" title="系统声音 Mac和Linux不支持系统内录">
                <a-button
                  :type="store.hasSystemAudio ? 'primary' : 'default'"
                  :disabled="
                    !supportsSystemAudio ||
                    store.recorderState != 'inactive' ||
                    store.disableOperation ||
                    store.loading
                  "
                  @click="toggleSystemAudio(!store.hasSystemAudio)"
                >
                  <template #icon>
                    <SoundOutlined />
                  </template>
                </a-button>
              </a-tooltip>
              <a-tooltip placement="bottom" title="主麦克风声音">
                <a-button
                  :type="store.hasMicrophoneAudio ? 'primary' : 'default'"
                  :disabled="
                    store.recorderState != 'inactive' || store.disableOperation || store.loading
                  "
                  @click="toggleMicrophone(!store.hasMicrophoneAudio)"
                >
                  <template #icon>
                    <AudioOutlined />
                  </template>
                </a-button>
              </a-tooltip>
            </a-button-group>
          </div>
        </div>
        <a-button-group>
          <a-tooltip placement="bottom" title="打开录像目录">
            <a-button @click="openOutputDir">
              <template #icon>
                <OpenIcon />
              </template>
            </a-button>
          </a-tooltip>
          <a-tooltip placement="bottom" title="设置">
            <a-button
              :disabled="
                store.recorderState != 'inactive' || store.disableOperation || store.loading
              "
              @click="store.settingVisible = true"
            >
              <template #icon>
                <SettingOutlined />
              </template>
            </a-button>
          </a-tooltip>
        </a-button-group>
      </div>
      <div class="mb-4 border"></div>
      <video id="video" ref="preview" class="width-100" muted autoplay playsinline></video>

      <Setting />
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AudioOutlined,
  DesktopOutlined,
  SettingOutlined,
  SoundOutlined,
  SyncOutlined
} from '@ant-design/icons-vue'
import OpenIcon from './components/OpenIcon.vue'
import PauseIcon from './components/PauseIcon.vue'
import PlayIcon from './components/PlayIcon.vue'
import RecordIcon from './components/RecordIcon.vue'
import StopIcon from './components/StopIcon.vue'
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

/**
 * 顶部状态提示文案，保持与目标插件一致的英文表述。
 * @returns 录制、暂停或倒计时阶段的提示文案。
 */
const infoText = computed(() => {
  if (store.recorderState == 'recording') {
    return 'Recording ' + recordedTime.value
  } else if (store.recorderState == 'paused') {
    return 'Paused ' + recordedTime.value
  } else {
    if (store.disableOperation && countdown.value) {
      return `Start record after ${countdown.value}s`
    } else {
      return ''
    }
  }
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

watch(
  () => store.errorText,
  (text) => {
    if (!text) return
    // 出现错误时立即停止录制，避免继续写入损坏文件。
    void stopRecording(store).catch(() => undefined)
  }
)

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

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.px-4 {
  padding: 0 1rem;
}

.py-4 {
  padding: 1rem 0;
}

.ml-3 {
  margin-left: 0.75rem;
}

.ml-4 {
  margin-left: 1rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.border {
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.my-4 {
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.flex {
  display: flex;
}

.self-end {
  align-self: flex-end;
}

.justify-space-between {
  justify-content: space-between;
}

.justify-end {
  justify-content: flex-end;
}

.width-100 {
  width: 100%;
}

.input-number {
  width: 3rem;
  height: 2rem;
}

.height-2 {
  height: 2rem;
}

.width-3 {
  width: 3rem;
}

.width-4 {
  width: 4rem;
}

.width-8 {
  width: 8rem;
}

.width-20 {
  width: 20rem;
}

.full-modal .ant-modal {
  max-width: 100%;
  top: 0;
  padding-bottom: 0;
  margin: 0;
}

.full-modal .ant-modal-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh);
}

.full-modal .ant-modal-body {
  flex: 1;
}

.ant-spin {
  z-index: 9999 !important;
}
</style>
