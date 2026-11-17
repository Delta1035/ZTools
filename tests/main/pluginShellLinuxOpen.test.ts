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
  },
  app: {
    getFileIcon: vi.fn()
  }
}))

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: electronMocks.app,
  ipcMain: electronMocks.ipcMain,
  shell: electronMocks.shell
}))

vi.mock('child_process', () => ({
  spawn: childProcessMocks.spawn,
  execFile: vi.fn()
}))

vi.mock('../../src/main/core/iconProtocol', () => ({
  getFileIconAsBase64: vi.fn()
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  WindowManager: {}
}))

vi.mock('../../src/main/utils/common', () => ({
  getExplorerFolderPathFromWindow: vi.fn()
}))

import PluginShellAPI from '../../src/main/api/plugin/shell'

/** 模拟 ipcMain.on 注册的同步 IPC 处理器。 */
type SyncHandler = (event: { returnValue?: unknown }, ...args: unknown[]) => void

const tempDirs: string[] = []
let originalPlatform: NodeJS.Platform
let handlers: Map<string, SyncHandler>

/**
 * 触发某个 IPC 通道的处理器。
 * @param channel IPC 通道名
 * @param payload 传给处理器的参数
 * @returns 处理器的返回值
 */
function invokeHandler(channel: string, payload: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册 IPC 通道：${channel}`)
  const event: { returnValue?: unknown } = {}
  handler(event, payload)
  return event.returnValue
}

/**
 * 让所有 spawn 调用失败，模拟系统未安装任何文件管理器。
 */
function mockSpawnFailure(message: string): void {
  childProcessMocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('error', new Error(message)))
    return child
  })
}

beforeEach(() => {
  originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

  handlers = new Map()
  electronMocks.ipcMain.on.mockImplementation((channel: string, handler: SyncHandler) => {
    handlers.set(channel, handler)
  })
  electronMocks.ipcMain.handle.mockReset()
  electronMocks.shell.openPath.mockReset()
  electronMocks.shell.openPath.mockResolvedValue('')
  electronMocks.shell.showItemInFolder.mockReset()
  childProcessMocks.spawn.mockReset()
  childProcessMocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('spawn'))
    return child
  })

  PluginShellAPI.init({ getCurrentWindow: vi.fn() } as never)
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true })))
})

describe('PluginShellAPI Linux 目录打开行为', () => {
  it('打开目录时使用文件管理器，而不是 xdg-open 默认关联', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-shell-'))
    tempDirs.push(root)

    invokeHandler('shell-open-path', root)
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled())

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'nautilus',
      ['--new-window', root],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(electronMocks.shell.openPath).not.toHaveBeenCalled()
  })

  it('打开文件时仍交给系统默认程序处理', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-shell-'))
    tempDirs.push(root)
    const filePath = path.join(root, 'record.webm')
    await fs.writeFile(filePath, 'video')

    invokeHandler('shell-open-path', filePath)
    await vi.waitFor(() => expect(electronMocks.shell.openPath).toHaveBeenCalled())

    expect(electronMocks.shell.openPath).toHaveBeenCalledWith(filePath)
    expect(childProcessMocks.spawn).not.toHaveBeenCalled()
  })

  it('在文件管理器中显示文件时打开所在目录', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-shell-'))
    tempDirs.push(root)
    const filePath = path.join(root, 'record.webm')
    await fs.writeFile(filePath, 'video')

    invokeHandler('shell-show-item-in-folder', filePath)
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled())

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'nautilus',
      ['--new-window', root],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(electronMocks.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('没有可用文件管理器时回退到系统默认方式打开目录', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-shell-'))
    tempDirs.push(root)
    mockSpawnFailure('没有默认文件管理器')

    invokeHandler('shell-open-path', root)
    await vi.waitFor(() => expect(electronMocks.shell.openPath).toHaveBeenCalled())

    expect(electronMocks.shell.openPath).toHaveBeenCalledWith(root)
  })

  it('没有可用文件管理器时回退到系统默认方式定位文件', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-shell-'))
    tempDirs.push(root)
    const filePath = path.join(root, 'record.webm')
    await fs.writeFile(filePath, 'video')
    mockSpawnFailure('没有默认文件管理器')

    invokeHandler('shell-show-item-in-folder', filePath)
    await vi.waitFor(() => expect(electronMocks.shell.showItemInFolder).toHaveBeenCalled())

    expect(electronMocks.shell.showItemInFolder).toHaveBeenCalledWith(filePath)
  })
})
