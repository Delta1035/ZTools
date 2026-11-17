<template>
  <a-modal v-model:open="store.settingVisible" title="录屏设置" :footer="null">
    <a-form layout="vertical">
      <a-form-item label="录像保存路径">
        <a-input-group compact>
          <a-input :value="store.outputDir" disabled />
          <a-button type="primary" @click="chooseOutputDirectory"> 选择 </a-button>
        </a-input-group>
      </a-form-item>
      <a-form-item label="默认保存格式">
        <a-select
          v-model:value="store.outputFormat"
          :options="formatOptions"
          @change="saveFormat"
        />
        <a-alert
          v-if="store.outputFormat === 'gif'"
          class="format-warning"
          type="warning"
          show-icon
          message="GIF 使用每秒一帧，长视频会产生较大文件。"
        />
      </a-form-item>
      <a-form-item label="最近录制">
        <a-list v-if="store.recentFileList.length" size="small" :data-source="store.recentFileList">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-typography-text ellipsis :content="item.filepath" />
              <a-button type="link" @click="openFile(item.filepath)">打开</a-button>
            </a-list-item>
          </template>
        </a-list>
        <a-empty v-else description="暂无录制文件" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useRecorderStore } from '../store'
import { recorderRuntime } from '../runtime'
import type { OutputFormat } from '../types'

const store = useRecorderStore()
const formatOptions = [
  { value: 'webm', label: 'WEBM（原始录制，速度最快）' },
  { value: 'mp4', label: 'MP4（需要 FFmpeg 转换）' },
  { value: 'gif', label: 'GIF（每秒一帧）' }
]

/**
 * 加载输出目录和最近录制文件。
 * @returns 无返回值。
 */
function loadRecentFiles(): void {
  store.outputDir = recorderRuntime.files.getOutputDir()
  store.recentFileList = recorderRuntime.files.getRecent()
}

/**
 * 打开目录选择对话框并保存用户选择。
 * @returns 无返回值。
 */
function chooseOutputDirectory(): void {
  const directories = recorderRuntime.dialogs.showOpenDialog({
    title: '选择录像保存目录',
    defaultPath: store.outputDir,
    buttonLabel: '选择此目录',
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
  })
  const directory = directories?.[0]
  if (!directory) return
  recorderRuntime.files.setOutputDir(directory)
  store.outputDir = directory
  message.success('保存目录已更新')
}

/**
 * 保存默认输出格式。
 * @param value 新的输出格式。
 * @returns 无返回值。
 */
function saveFormat(value: OutputFormat): void {
  recorderRuntime.storage.set('outfileFormat', value)
}

/**
 * 使用系统默认程序打开录制文件。
 * @param filePath 录制文件路径。
 * @returns 无返回值。
 */
function openFile(filePath: string): void {
  recorderRuntime.shell.openPath(filePath)
}

onMounted(loadRecentFiles)
</script>

<style scoped>
.format-warning {
  margin-top: 12px;
}
</style>
