import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const electronMocks = vi.hoisted(() => ({
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {},
  clipboard: {},
  ipcMain: electronMocks.ipcMain,
  Menu: {},
  nativeImage: {},
  shell: electronMocks.shell
}))

vi.mock('child_process', () => ({
  spawn: childProcessMocks.spawn
}))

vi.mock('../../src/main/core/appData/appDataPaths', () => ({
  getAvatarPath: () => '/tmp/ztools-system-test-avatar'
}))

vi.mock('../../src/main/managers/clipboardManager', () => ({
  default: { getLastCopiedContent: vi.fn() }
}))

vi.mock('../../src/main/utils/appleScriptHelper', () => ({
  default: {}
}))

vi.mock('../../src/main/utils/windowUtils', () => ({
  isWindows11: vi.fn(),
  openDialog: vi.fn()
}))

import { SystemAPI } from '../../src/main/api/renderer/system'

const tempDirs: string[] = []
let systemAPI: SystemAPI

beforeEach(() => {
  systemAPI = new SystemAPI()
  electronMocks.shell.openPath.mockReset()
  electronMocks.shell.showItemInFolder.mockReset()
  childProcessMocks.spawn.mockReset()
  childProcessMocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      unref: () => void
      stderr: EventEmitter
    }
    child.unref = vi.fn()
    child.stderr = new EventEmitter()
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true })))
})

describe('SystemAPI.revealInFinder', () => {
  it('opens a plugin directory with the system file manager', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-reveal-'))
    tempDirs.push(root)
    electronMocks.shell.openPath.mockResolvedValue('')

    await systemAPI.revealInFinder(root)

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'nautilus',
      ['--new-window', root],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(electronMocks.shell.openPath).not.toHaveBeenCalled()
    expect(electronMocks.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens the parent directory for an ASAR plugin file on Linux', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-reveal-'))
    tempDirs.push(root)
    const filePath = path.join(root, 'plugin.asar')
    await fs.writeFile(filePath, 'plugin')

    await systemAPI.revealInFinder(filePath)

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'nautilus',
      ['--new-window', root],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(electronMocks.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('propagates file manager startup errors so the setting page can show feedback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-reveal-'))
    tempDirs.push(root)
    childProcessMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        unref: () => void
        stderr: EventEmitter
      }
      child.unref = vi.fn()
      child.stderr = new EventEmitter()
      queueMicrotask(() => child.emit('error', new Error('没有默认文件管理器')))
      return child
    })

    await expect(systemAPI.revealInFinder(root)).rejects.toThrow('Linux 文件管理器未实现或无法启动')
  })
})
