export type AudioSource = 'system' | 'mic'
export type OutputFormat = 'webm' | 'mp4' | 'gif'
export type RecorderState = 'inactive' | 'recording' | 'paused'
export type PlatformName = 'windows' | 'macos' | 'linux'

export interface CaptureSource {
  id: string
  name: string
  appIcon?: { toDataURL?: () => string }
  appIconURL?: string
}

export interface MediaFileBridge {
  newFile: () => string
  appendData: (data: Uint8Array) => void
  close: () => void
  getCurrentPath: () => string | null
  getOutputDir: () => string
  setOutputDir: (directory: string) => void
  getRecentFiles: () => RecentFile[]
  addRecentFile: (file: RecentFile) => void
  getMediaFilePath: () => string | null
  getMediaFileName: () => string
  NewMediaFile: () => string
  WriteMediaFile: (data: Uint8Array) => void
  CloseMediaFile: () => void
  getRecentFilelist: () => RecentFile[]
  addToRecentFilelist: (file: RecentFile) => void
  Buffer: typeof Buffer
}

export interface RecentFile {
  filepath: string
}

export interface RecorderCapabilities {
  systemAudio: boolean
  microphone: boolean
  desktopCapture: boolean
  ffmpeg: boolean
}

export interface RecorderRuntime {
  platform: {
    os: PlatformName
    capabilities: RecorderCapabilities
  }
  capture: {
    listSources: () => Promise<CaptureSource[]>
    createStream: (
      source: CaptureSource,
      options: { microphone: boolean; systemAudio: boolean }
    ) => Promise<MediaStream>
  }
  files: {
    create: () => string
    append: (data: Uint8Array) => void
    close: () => void
    getCurrentPath: () => string | null
    getOutputDir: () => string
    setOutputDir: (directory: string) => void
    getRecent: () => RecentFile[]
    addRecent: (file: RecentFile) => void
  }
  dialogs: {
    showOpenDialog: (options: Record<string, unknown>) => string[] | undefined
  }
  conversion: {
    convert: (inputPath: string, format: OutputFormat) => Promise<string>
  }
  storage: {
    get: <T>(key: string) => T | null
    set: <T>(key: string, value: T) => void
  }
  lifecycle: {
    onEnter: (callback: (payload: PluginEnterPayload) => void) => Promise<void>
    hideMainWindow: () => Promise<void>
    showMainWindow: () => boolean
    setSubInput: (placeholder: string) => Promise<void>
  }
  shell: {
    openPath: (fullPath: string) => string
    showItemInFolder: (fullPath: string) => void
    beep: () => void
    showToast: (message: string) => Promise<void>
  }
}

export interface ZToolsApi {
  isWindows: () => boolean
  isLinux: () => boolean
  getPath: (name: string) => string
  dbStorage: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string | number) => void
  }
  desktopCaptureSources: (options: {
    types: Array<'screen' | 'window'>
    thumbnailSize: { width: number; height: number }
    fetchWindowIcons: boolean
  }) => Promise<CaptureSource[]>
  runFFmpeg: (args: string[], options?: { onLog?: (text: string) => void }) => Promise<void>
  showOpenDialog: (options: Record<string, unknown>) => string[] | undefined
  showToast: (message: string, options?: Record<string, unknown>) => Promise<unknown>
  setSubInput: (
    onChange: ((text: string) => void) | null,
    placeholder?: string,
    isFocus?: boolean
  ) => Promise<unknown>
  onPluginEnter: (callback: (payload: PluginEnterPayload) => void) => Promise<void>
  hideMainWindow: () => Promise<unknown>
  showMainWindow: () => boolean
  shellOpenPath: (fullPath: string) => string
  shellShowItemInFolder: (fullPath: string) => void
  shellBeep: () => void
}

export interface PluginEnterPayload {
  code?: string
  type?: string
  payload?: unknown
}

export interface RecorderStoreState {
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
}
