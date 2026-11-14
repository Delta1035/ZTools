import { app } from 'electron'
import { execFileSync } from 'child_process'

/**
 * Linux/Wayland 全局唤起快捷键集成模块。
 *
 * 在 Wayland 环境下，应用程序无法自行抢占全局键盘事件。
 * 本模块通过 GNOME 的 gsettings 自定义快捷键机制，将快捷键委托给桌面环境持有，
 * 并在按下时触发 `ztools --toggle`，通过 Electron 的 second-instance 事件通知主实例切换窗口。
 */

const MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys'
const CUSTOM_KEYBINDING_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding'
const CUSTOM_KEYBINDING_PATH_PREFIX =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/'

/**
 * 检测当前桌面环境是否为 GNOME 或其衍生环境。
 *
 * @returns 若当前为 GNOME 或 Ubuntu 桌面返回 true，否则返回 false。
 */
export function isGnomeDesktop(): boolean {
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase()
  return desktop.includes('gnome') || desktop.includes('ubuntu')
}

/**
 * 将 Electron accelerator 字符串转换为 GNOME 自定义快捷键格式。
 * 例如：`Option+Z` 转换为 `<Alt>z`，`Ctrl+Shift+Space` 转换为 `<Primary><Shift>space`。
 *
 * @param accelerator Electron 风格的快捷键描述。
 * @returns GNOME 风格快捷键；若为无主键的双击修饰键等无法映射的组合则返回 null。
 */
export function toGnomeAccelerator(accelerator: string): string | null {
  if (!accelerator || !accelerator.trim()) return null

  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  const modifiers: string[] = []
  let key = ''

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'command':
      case 'cmd':
      case 'super':
      case 'meta':
        modifiers.push('<Super>')
        break
      case 'ctrl':
      case 'control':
      case 'commandorcontrol':
      case 'cmdorctrl':
        modifiers.push('<Primary>')
        break
      case 'alt':
      case 'option':
        modifiers.push('<Alt>')
        break
      case 'shift':
        modifiers.push('<Shift>')
        break
      default:
        key = part
    }
  }

  // 双击修饰键（如 Command+Command、Ctrl+Ctrl）无具体主键，无法映射为系统级按键
  if (!key) return null

  return modifiers.join('') + key.toLowerCase()
}

/**
 * 生成在快捷键触发时执行的唤起命令。
 *
 * @returns 供 GNOME 快捷键执行的命令行调用字符串。
 */
export function getToggleCommand(): string {
  // AppImage 下 execPath 指向临时挂载点（/tmp/.mount_xxx），卸载后即失效，
  // 必须优先使用 APPIMAGE 记录的本体持久路径
  const appImagePath = process.env.APPIMAGE
  if (appImagePath) {
    return `"${appImagePath}" --toggle`
  }

  // 打包后的可执行文件路径
  if (app.isPackaged) {
    return `"${process.execPath}" --toggle`
  }

  // 开发态需要通过 electron 运行项目源码目录
  return `"${process.execPath}" "${app.getAppPath()}" --toggle`
}

/**
 * 执行 gsettings 命令行并返回标准输出。
 *
 * @param args gsettings 参数列表。
 * @returns 命令输出的纯文本内容。
 * @throws 当子进程执行失败时抛出包含 stderr 的错误。
 */
function gsettings(args: string[]): string {
  try {
    return execFileSync('gsettings', args, { encoding: 'utf-8' }).trim()
  } catch (error) {
    // 捕获 stderr 以透出详细失败原因
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw new Error(stderr ? String(stderr).trim() : String(error))
  }
}

/**
 * 编码为 GVariant 字符串字面量，防止引号解析错位。
 *
 * @param value 原始字符串。
 * @returns 转义后的 GVariant 字符串表达式。
 */
function toGVariantString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * 读取 GNOME 当前已注册的所有自定义快捷键路径。
 *
 * @returns 自定义快捷键路径字符串数组。
 */
function getCustomKeybindingPaths(): string[] {
  const raw = gsettings(['get', MEDIA_KEYS_SCHEMA, 'custom-keybindings'])
  return [...raw.matchAll(/'([^']*)'/g)].map((match) => match[1])
}

/**
 * 检索尚未被占用的 customN 快捷键配置槽位。
 *
 * @param existing 当前已占用的快捷键路径列表。
 * @returns 空闲槽位编号（0~31）。
 * @throws 当 32 个槽位全部被占满时抛出错误。
 */
function findFreeSlot(existing: string[]): number {
  for (let i = 0; i < 32; i++) {
    if (!existing.some((p) => p.endsWith(`custom${i}/`))) {
      return i
    }
  }
  throw new Error('GNOME 自定义快捷键槽位已用满（custom0-31）')
}

/**
 * 将指定快捷键注册到 GNOME 桌面环境的系统自定义快捷键中。
 *
 * @param accelerator 当前配置的快捷键（Electron 风格）。
 * @returns 操作结果及用户提示信息。
 */
export function installGnomeShortcut(accelerator: string): {
  success: boolean
  message: string
} {
  // 校验当前环境是否为支持的 GNOME 桌面
  if (!isGnomeDesktop()) {
    return {
      success: false,
      message: `当前桌面环境不是 GNOME，无法自动配置系统快捷键。请手动把快捷键绑定到命令：${getToggleCommand()}`
    }
  }

  // 格式转换为 GNOME 快捷键表达式
  const binding = toGnomeAccelerator(accelerator)
  if (!binding) {
    return {
      success: false,
      message: `无法把「${accelerator}」转换为系统快捷键格式（双击修饰键无法注册为系统快捷键）。请改用 Ctrl/Alt + 单键的组合。`
    }
  }

  let command = ''
  try {
    command = getToggleCommand()
    const existing = getCustomKeybindingPaths()
    const bindingPath = `${CUSTOM_KEYBINDING_PATH_PREFIX}custom${findFreeSlot(existing)}/`
    const schemaWithPath = `${CUSTOM_KEYBINDING_SCHEMA}:${bindingPath}`

    // 写入条目的各项属性
    gsettings(['set', schemaWithPath, 'name', toGVariantString('ZTools')])
    gsettings(['set', schemaWithPath, 'command', toGVariantString(command)])
    gsettings(['set', schemaWithPath, 'binding', toGVariantString(binding)])

    // 将新条目合并到 GNOME 快捷键主列表中
    gsettings([
      'set',
      MEDIA_KEYS_SCHEMA,
      'custom-keybindings',
      `[${[...existing, bindingPath].map((p) => `'${p}'`).join(', ')}]`
    ])

    console.log(`[LinuxShortcut] 已注册 GNOME 自定义快捷键 ${binding} -> ${command}`)

    return {
      success: true,
      message: `已把系统快捷键 ${binding} 绑定到 ZTools 的显示/隐藏。若未生效，请在「系统设置 → 键盘 → 自定义快捷键」中检查是否冲突。`
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[LinuxShortcut] 注册 GNOME 自定义快捷键失败:', error)
    return {
      success: false,
      message: `注册系统快捷键失败：${reason}。可手动在「系统设置 → 键盘 → 自定义快捷键」中把 ${binding} 绑定到命令：${command || getToggleCommand()}`
    }
  }
}
