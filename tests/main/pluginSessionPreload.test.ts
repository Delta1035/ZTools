import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { ensurePluginSessionPreload } from '../../src/main/core/pluginSessionPreload'

describe('plugin session preload registration', () => {
  it('registers the host preload only once across repeated child window creation', () => {
    const scripts: Array<{ id: string; type: 'frame'; filePath: string }> = []
    const session = {
      getPreloadScripts: vi.fn(() => scripts),
      registerPreloadScript: vi.fn((script) => {
        scripts.push({ ...script, id: 'host-preload' })
        return 'host-preload'
      }),
      unregisterPreloadScript: vi.fn()
    }
    for (let index = 0; index < 5; index++)
      ensurePluginSessionPreload(session as unknown as Session, '/tmp/preload.js')
    expect(session.registerPreloadScript).toHaveBeenCalledTimes(1)
    expect(scripts).toHaveLength(1)
  })

  it('replaces the previous plugin preload within the same scope', () => {
    const scripts: Array<{ id: string; type: 'frame'; filePath: string }> = []
    const session = {
      getPreloadScripts: vi.fn(() => scripts),
      registerPreloadScript: vi.fn((script: { type: 'frame'; filePath: string }) => {
        const id = `preload-${scripts.length + 1}`
        scripts.push({ ...script, id })
        return id
      }),
      unregisterPreloadScript: vi.fn((id: string) => {
        const index = scripts.findIndex((script) => script.id === id)
        if (index >= 0) scripts.splice(index, 1)
      })
    }

    ensurePluginSessionPreload(session as unknown as Session, '/tmp/old-preload.js', 'plugin:test')
    ensurePluginSessionPreload(session as unknown as Session, '/tmp/new-preload.js', 'plugin:test')

    expect(session.unregisterPreloadScript).toHaveBeenCalledWith('preload-1')
    expect(scripts).toEqual([{ id: 'preload-1', type: 'frame', filePath: '/tmp/new-preload.js' }])
  })
})
