<template>
  <a-modal
    v-model:visible="store.settingVisible"
    title="设置"
    width="100%"
    wrap-class-name="full-modal"
    :mask-style="{ 'background-color': 'white' }"
    :footer="null"
    @ok="onSettingOkClick"
  >
    <a-form>
      <a-form-item v-if="data.alertShow">
        <a-alert
          v-if="data.alertShow"
          message="注意"
          description="长视频由于体积大不适合转换成GIF"
          type="warning"
          closable
        />
      </a-form-item>
      <a-form-item label="录像保存路径">
        <a-input-group compact>
          <a-input v-model:value="store.outputDir" disabled style="width: calc(100% - 36px)" />
          <a-button type="primary" @click="chooseOutputDirectory">
            <template #icon>
              <FolderOpenOutlined />
            </template>
          </a-button>
        </a-input-group>
      </a-form-item>

      <a-form-item label="默认保存格式">
        <a-select
          v-model:value="store.outputFormat"
          :options="data.fileTypeOption"
          @change="saveFormat"
        >
        </a-select>
      </a-form-item>

      <div class="flex justify-end">
        <a-button type="primary" @click="onSettingOkClick">应用</a-button>
      </div>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { FolderOpenOutlined } from '@ant-design/icons-vue'
import { useRecorderStore } from '../store'
import { recorderRuntime } from '../runtime'
import type { OutputFormat } from '../types'

const store = useRecorderStore()

const data = reactive({
  fileTypeOption: [
    {
      value: 'webm',
      label: 'WEBM'
    },
    {
      value: 'mp4',
      label: 'MP4'
    },
    {
      value: 'gif',
      label: 'GIF'
    }
  ],
  alertShow: false
})

/**
 * 关闭设置弹窗。
 * @returns 无返回值。
 */
function onSettingOkClick(): void {
  store.settingVisible = false
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
}

/**
 * 保存默认输出格式。
 * @param value 新的输出格式。
 * @returns 无返回值。
 */
function saveFormat(value: OutputFormat): void {
  recorderRuntime.storage.set('outfileFormat', value)
  if (value === 'gif') {
    // 与目标插件一致：提示 5 秒后自动消失。
    data.alertShow = true
    setTimeout(() => {
      data.alertShow = false
    }, 5000)
  }
}
</script>
