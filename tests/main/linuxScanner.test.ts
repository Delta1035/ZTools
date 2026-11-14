import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock common 工具中的 extractAcronym
vi.mock('../../src/main/utils/common', () => ({
  extractAcronym: (name: string) =>
    name
      .split(/[\s-]+/)
      .map((w) => w[0])
      .join('')
      .toLowerCase()
}))

let tempBase: string
let originalXdgDataDirs: string | undefined
let originalXdgDataHome: string | undefined

beforeEach(() => {
  tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-linux-scan-'))
  originalXdgDataDirs = process.env.XDG_DATA_DIRS
  originalXdgDataHome = process.env.XDG_DATA_HOME
  // 将 XDG_DATA_DIRS 与 XDG_DATA_HOME 指向临时目录，实现文件系统隔离
  process.env.XDG_DATA_DIRS = path.join(tempBase, 'system_share')
  process.env.XDG_DATA_HOME = path.join(tempBase, 'user_share')
  vi.spyOn(os, 'homedir').mockReturnValue(tempBase)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalXdgDataDirs === undefined) {
    delete process.env.XDG_DATA_DIRS
  } else {
    process.env.XDG_DATA_DIRS = originalXdgDataDirs
  }
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }
  fs.rmSync(tempBase, { recursive: true, force: true })
})

describe('linuxScanner 应用扫描与解析', () => {
  it('普通 .desktop 与符号链接 .desktop 均可被扫描到', async () => {
    const userApps = path.join(tempBase, 'user_share', 'applications')
    fs.mkdirSync(userApps, { recursive: true })

    // 1) 普通 .desktop 文件
    fs.writeFileSync(
      path.join(userApps, 'normal.desktop'),
      `[Desktop Entry]
Type=Application
Name=Normal App
Exec=/usr/bin/normal
`
    )

    // 2) 模拟 Flatpak 导出的符号链接 .desktop 文件
    const targetsDir = path.join(tempBase, 'targets')
    fs.mkdirSync(targetsDir, { recursive: true })
    const targetFile = path.join(targetsDir, 'flatpak-app')
    fs.writeFileSync(
      targetFile,
      `[Desktop Entry]
Type=Application
Name=Flatpak App
Exec=flatpak run org.example.App
`
    )
    fs.symlinkSync(targetFile, path.join(userApps, 'org.example.App.desktop'))

    const { scanApplications } = await import('../../src/main/core/commandScanner/linuxScanner')
    const apps = await scanApplications()
    const names = apps.map((a) => a.name)

    expect(names).toContain('Normal App')
    expect(names).toContain('Flatpak App')
  })

  it('用户级应用优先覆盖同名系统级应用（XDG desktop ID 去重）', async () => {
    const userApps = path.join(tempBase, 'user_share', 'applications')
    const systemApps = path.join(tempBase, 'system_share', 'applications')
    fs.mkdirSync(userApps, { recursive: true })
    fs.mkdirSync(systemApps, { recursive: true })

    // 系统预装版本
    fs.writeFileSync(
      path.join(systemApps, 'editor.desktop'),
      `[Desktop Entry]
Type=Application
Name=System Editor
Exec=/usr/bin/sys-editor
`
    )

    // 用户自定义同名版本
    fs.writeFileSync(
      path.join(userApps, 'editor.desktop'),
      `[Desktop Entry]
Type=Application
Name=User Editor
Exec=/usr/local/bin/user-editor
`
    )

    const { scanApplications } = await import('../../src/main/core/commandScanner/linuxScanner')
    const apps = await scanApplications()
    const editorApp = apps.find((a) => a.name === 'User Editor')

    expect(editorApp).toBeDefined()
    expect(editorApp?.path).toBe('/usr/local/bin/user-editor')
    expect(apps.some((a) => a.name === 'System Editor')).toBe(false)
  })

  it('过滤 NoDisplay=true 与 Hidden=true 的条目', async () => {
    const userApps = path.join(tempBase, 'user_share', 'applications')
    fs.mkdirSync(userApps, { recursive: true })

    fs.writeFileSync(
      path.join(userApps, 'hidden.desktop'),
      `[Desktop Entry]
Type=Application
Name=Hidden App
Exec=/usr/bin/hidden
NoDisplay=true
`
    )

    const { scanApplications } = await import('../../src/main/core/commandScanner/linuxScanner')
    const apps = await scanApplications()
    expect(apps.some((a) => a.name === 'Hidden App')).toBe(false)
  })

  it('Terminal=true 的条目包装为 gio launch 命令', async () => {
    const userApps = path.join(tempBase, 'user_share', 'applications')
    fs.mkdirSync(userApps, { recursive: true })

    const desktopFile = path.join(userApps, 'term-tool.desktop')
    fs.writeFileSync(
      desktopFile,
      `[Desktop Entry]
Type=Application
Name=Terminal Tool
Exec=/usr/bin/term-tool
Terminal=true
`
    )

    const { scanApplications } = await import('../../src/main/core/commandScanner/linuxScanner')
    const apps = await scanApplications()
    const termApp = apps.find((a) => a.name === 'Terminal Tool')

    expect(termApp).toBeDefined()
    expect(termApp?.path).toBe(`gio launch "${desktopFile}"`)
  })
})
