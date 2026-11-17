import { defineStore } from 'pinia'
import type { AudioSource, CaptureSource, OutputFormat, RecentFile, RecorderState } from './types'

export const useRecorderStore = defineStore('recorder', {
  state: (): {
    recorderState: RecorderState
    selectedVideoSource: string
    videoSources: CaptureSource[]
    audioSources: AudioSource[]
    delayStart: number
    disableOperation: boolean
    errorText: string
    savedFilePath: string
    loading: boolean
    settingVisible: boolean
    outputDir: string
    recentFileList: RecentFile[]
    outputFormat: OutputFormat
  } => ({
    recorderState: 'inactive',
    selectedVideoSource: '',
    videoSources: [],
    audioSources: [],
    delayStart: 3,
    disableOperation: false,
    errorText: '',
    savedFilePath: '',
    loading: false,
    settingVisible: false,
    outputDir: '',
    recentFileList: [],
    outputFormat: 'webm'
  }),
  getters: {
    videoOptions: (state) =>
      state.videoSources.map((source) => ({
        value: source.id,
        label: source.name,
        key: source.id,
        icon: source.appIconURL
      })),
    hasSystemAudio: (state) => state.audioSources.includes('system'),
    hasMicrophoneAudio: (state) => state.audioSources.includes('mic')
  }
})
