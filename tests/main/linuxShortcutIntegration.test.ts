import { describe, it, expect, vi, afterEach } from 'vitest'
import { app } from 'electron'

// 该模块只用到 app.isPackaged / app.getAppPath，测试环境中使用模拟对象
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/opt/ztools' }
}))

// 拦截 gsettings：记录调用参数并模拟已有的自定义快捷键条目
const mocks = vi.hoisted(() => ({
  calls: [] as string[][],
  getResult: "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
}))

vi.mock('child_process', () => ({
  execFileSync: (_cmd: string, args: string[]) => {
    mocks.calls.push(args)
    return args[0] === 'get' ? mocks.getResult : ''
  }
}))

const { toGnomeAccelerator, getToggleCommand, installGnomeShortcut } =
  await import('../../src/main/core/linuxShortcutIntegration')

describe('toGnomeAccelerator', () => {
  it('把 macOS 风格的 Option 映射为 <Alt>', () => {
    expect(toGnomeAccelerator('Option+Z')).toBe('<Alt>z')
  })

  it('把 Alt 映射为 <Alt> 并把主键小写', () => {
    expect(toGnomeAccelerator('Alt+Space')).toBe('<Alt>space')
  })

  it('把 Ctrl 映射为 <Primary>', () => {
    expect(toGnomeAccelerator('Ctrl+Space')).toBe('<Primary>space')
  })

  it('支持多个修饰键并保持顺序', () => {
    expect(toGnomeAccelerator('Ctrl+Shift+Z')).toBe('<Primary><Shift>z')
  })

  it('把 Command/Super 映射为 <Super>', () => {
    expect(toGnomeAccelerator('Command+Z')).toBe('<Super>z')
  })

  it('组合键顺序变化保持转换正确', () => {
    expect(toGnomeAccelerator('Shift+Ctrl+Z')).toBe('<Shift><Primary>z')
  })

  it('双击修饰键（无主键）无法映射，返回 null', () => {
    expect(toGnomeAccelerator('Command+Command')).toBeNull()
    expect(toGnomeAccelerator('Ctrl+Ctrl')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(toGnomeAccelerator('')).toBeNull()
  })
})

describe('getToggleCommand', () => {
  afterEach(() => {
    delete process.env.APPIMAGE
    app.isPackaged = false
  })

  it('开发模式下带上 Electron 与应用路径', () => {
    expect(getToggleCommand()).toBe(`"${process.execPath}" "/opt/ztools" --toggle`)
  })

  it('生产打包态直接使用可执行文件路径', () => {
    app.isPackaged = true
    expect(getToggleCommand()).toBe(`"${process.execPath}" --toggle`)
  })

  it('AppImage 环境下使用持久化的 APPIMAGE 环境变量路径', () => {
    process.env.APPIMAGE = '/home/user/Applications/ZTools.AppImage'
    expect(getToggleCommand()).toBe('"/home/user/Applications/ZTools.AppImage" --toggle')
  })
})

describe('installGnomeShortcut', () => {
  const originalDesktop = process.env.XDG_CURRENT_DESKTOP

  afterEach(() => {
    if (originalDesktop === undefined) {
      delete process.env.XDG_CURRENT_DESKTOP
    } else {
      process.env.XDG_CURRENT_DESKTOP = originalDesktop
    }
    mocks.calls = []
  })

  it('非 GNOME 环境拒绝并提示用户手动绑定', () => {
    process.env.XDG_CURRENT_DESKTOP = 'KDE'
    const result = installGnomeShortcut('Alt+Z')
    expect(result.success).toBe(false)
    expect(result.message).toContain('当前桌面环境不是 GNOME')
  })

  it('双击修饰键格式给出具体不支持的提示', () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME'
    const result = installGnomeShortcut('Ctrl+Ctrl')
    expect(result.success).toBe(false)
    expect(result.message).toContain('双击修饰键无法注册为系统快捷键')
  })

  it('GNOME 环境成功追加 custom1 并合并到主列表', () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME'
    const result = installGnomeShortcut('Alt+Z')

    expect(result.success).toBe(true)
    expect(result.message).toContain('已把系统快捷键 <Alt>z 绑定到 ZTools 的显示/隐藏')

    // 验证 custom0 已经被占用，新条目应写入 custom1
    const setCalls = mocks.calls.filter((args) => args[0] === 'set')
    expect(setCalls.length).toBe(4)

    const [nameCall, commandCall, bindingCall, listCall] = setCalls
    expect(nameCall[1]).toContain('custom1')
    expect(nameCall[3]).toBe("'ZTools'")

    expect(commandCall[1]).toContain('custom1')
    expect(commandCall[3]).toContain('--toggle')

    expect(bindingCall[1]).toContain('custom1')
    expect(bindingCall[3]).toBe("'<Alt>z'")

    // 主列表同时包含 custom0 和 custom1
    expect(listCall[3]).toContain('custom0')
    expect(listCall[3]).toContain('custom1')
  })
})
