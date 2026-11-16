import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('electron', () => ({
  app: {},
  clipboard: {},
  ipcMain: electronMocks.ipcMain,
  Menu: {},
  nativeImage: {},
  shell: electronMocks.shell
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

    expect(electronMocks.shell.openPath).toHaveBeenCalledWith(root)
    expect(electronMocks.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('reveals a file without opening it as a directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-reveal-'))
    tempDirs.push(root)
    const filePath = path.join(root, 'plugin.asar')
    await fs.writeFile(filePath, 'plugin')

    await systemAPI.revealInFinder(filePath)

    expect(electronMocks.shell.showItemInFolder).toHaveBeenCalledWith(filePath)
    expect(electronMocks.shell.openPath).not.toHaveBeenCalled()
  })

  it('propagates file manager errors so the setting page can show feedback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-reveal-'))
    tempDirs.push(root)
    electronMocks.shell.openPath.mockResolvedValue('无法启动文件管理器')

    await expect(systemAPI.revealInFinder(root)).rejects.toThrow('无法启动文件管理器')
  })
})
