/// <reference types="vite/client" />

import type { MediaFileBridge, ZToolsApi } from './types'

declare global {
  interface Window {
    ztools: ZToolsApi
    mediaFile: MediaFileBridge
  }
}

export {}
