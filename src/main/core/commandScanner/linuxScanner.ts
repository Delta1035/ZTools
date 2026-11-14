import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { pinyin as getPinyin } from 'pinyin-pro'
import { extractAcronym } from '../../utils/common'
import { getLinuxApplicationPaths } from '../../utils/systemPaths'
import { Command } from './types'
import { pLimit } from './utils'

// ============================================================
// XDG .desktop 文件解析器
// ============================================================

interface DesktopEntry {
  Name?: string
  GenericName?: string
  Comment?: string
  Exec?: string
  TryExec?: string
  Icon?: string
  NoDisplay?: string
  Hidden?: string
  Type?: string
  Terminal?: string
  DBusActivatable?: string
  OnlyShowIn?: string
  NotShowIn?: string
  // 本地化字段
  [key: string]: string | undefined
}

/**
 * 解析 .desktop 文件，提取 [Desktop Entry] 部分的键值对。
 *
 * @param content .desktop 文件的完整文本内容。
 * @returns 解析得到的 DesktopEntry 字段映射表。
 */
function parseDesktopFile(content: string): DesktopEntry {
  const result: DesktopEntry = {}
  let inDesktopEntry = false

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()

    // 仅关注 [Desktop Entry] 段落，忽略其他 Actions 等子段落
    if (line === '[Desktop Entry]') {
      inDesktopEntry = true
      continue
    }

    // 遇到下一个段落时停止解析
    if (line.startsWith('[') && line.endsWith(']') && inDesktopEntry) {
      break
    }

    if (!inDesktopEntry || !line || line.startsWith('#')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    result[key] = value
  }

  return result
}

/**
 * 按 XDG 规范解析系统语言优先级列表。
 *
 * @returns 语言代号候选列表，优先级由高到低。
 */
function getLanguagePriorityList(): string[] {
  // LANGUAGE 是冒号分隔的优先级列表，优先级高于 LC_ALL/LC_MESSAGES/LANG
  const raw =
    process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  const tokens = raw.split(':').filter(Boolean)
  const candidates: string[] = []

  for (const token of tokens) {
    const base = token.split('.')[0] // 去除编码后缀（如 UTF-8）
    if (base && !candidates.includes(base)) {
      candidates.push(base)
      const langOnly = base.split('_')[0]
      if (langOnly && !candidates.includes(langOnly)) {
        candidates.push(langOnly)
      }
    }
  }

  return candidates
}

/**
 * 获取符合当前系统语言偏好的本地化应用名称。
 *
 * @param entry 解析出的桌面条目对象。
 * @returns 最佳匹配的本地化名称；未匹配到时回退到默认 Name。
 */
function getLocalizedName(entry: DesktopEntry): string {
  const langs = getLanguagePriorityList()

  // 按系统语言优先级尝试匹配 Name[xx_XX] 或 Name[xx]
  for (const lang of langs) {
    const value = entry[`Name[${lang}]`]
    if (value && value.trim()) {
      return value.trim()
    }
  }

  return entry['Name']?.trim() || ''
}

/**
 * 清理 Exec 字段中的参数占位符并规范化执行命令。
 *
 * @param exec 原始 Exec 字符串。
 * @returns 清理后的可执行命令字符串。
 */
function cleanExecCommand(exec: string): string {
  return exec
    .replace(/%[a-zA-Z]/g, '') // 移除 %f %u %F %U 等占位符
    .replace(/\s+/g, ' ') // 合并多余空格
    .trim()
}

// ============================================================
// 图标解析
// ============================================================

/**
 * 获取 Linux XDG 图标主题搜索路径列表。
 *
 * @returns 按优先级排序的图标搜索目录。
 */
function getIconSearchPaths(): string[] {
  const home = os.homedir()
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(home, '.local/share')

  return [
    path.join(xdgDataHome, 'icons'),
    path.join(home, '.local/share/icons'),
    '/usr/share/icons',
    '/usr/share/pixmaps',
    path.join(home, '.icons'),
    '/usr/local/share/icons',
    '/usr/local/share/pixmaps',
    // Flatpak 图标导出目录（与 .desktop 导出目录对应）
    path.join(xdgDataHome, 'flatpak/exports/share/icons'),
    '/var/lib/flatpak/exports/share/icons'
  ]
}

const ICON_EXTENSIONS = ['.png', '.svg', '.xpm']
const ICON_PREFERRED_SIZES = [
  '512x512',
  '256x256',
  '128x128',
  '64x64',
  '48x48',
  '32x32',
  'scalable'
]

/**
 * 在 XDG 图标主题中检索对应的图标文件路径。
 *
 * @param iconName .desktop 文件中的 Icon 字段值。
 * @returns 命中图标的绝对文件路径；未找到返回 null。
 */
async function findIconPath(iconName: string): Promise<string | null> {
  // 如果是绝对路径且可访问，直接返回
  if (iconName.startsWith('/')) {
    try {
      await fs.access(iconName)
      return iconName
    } catch {
      // 忽略不可访问路径
    }
  }

  // 去除可能自带的图片后缀
  const baseName = iconName.replace(/\.(png|svg|xpm)$/, '')
  const searchPaths = getIconSearchPaths()

  for (const searchPath of searchPaths) {
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true })
      // 兼容某些发行版中以符号链接存在的主题目录（如 hicolor）
      const themes = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name)

      for (const theme of ['hicolor', ...themes]) {
        for (const size of ICON_PREFERRED_SIZES) {
          for (const category of ['apps', 'applications']) {
            for (const ext of ICON_EXTENSIONS) {
              const iconPath = path.join(searchPath, theme, size, category, baseName + ext)
              try {
                await fs.access(iconPath)
                return iconPath
              } catch {
                // 忽略未命中的尺寸与类别组合
              }
            }
          }
        }
      }
    } catch {
      // 目录不存在或无权访问，跳过
    }

    // pixmaps 顶层直接存放 baseName.ext 的回退查找
    for (const ext of ICON_EXTENSIONS) {
      const iconPath = path.join(searchPath, baseName + ext)
      try {
        await fs.access(iconPath)
        return iconPath
      } catch {
        // 忽略未命中文件
      }
    }
  }

  return null
}

// ============================================================
// 拼音与命令检索辅助
// ============================================================

/**
 * 提取中文字符串的拼音首字母缩写。
 *
 * @param name 中文字符串。
 * @returns 拼音首字母串。
 */
function extractPinyinAcronym(name: string): string {
  let result = ''
  for (const char of name) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      try {
        result += getPinyin(char, { pattern: 'first', toneType: 'none' })
      } catch {
        // 忽略单字转换失败
      }
    } else if (/[a-zA-Z]/.test(char)) {
      result += char.toLowerCase()
    }
  }
  return result
}

/**
 * 检查字符串是否包含中文字符。
 *
 * @param str 待检测字符串。
 * @returns 包含中文返回 true，否则返回 false。
 */
function hasChinese(str: string): boolean {
  return /[\u4e00-\u9fa5]/.test(str)
}

/**
 * 检查 TryExec 指定的可执行程序是否在环境变量 PATH 或指定绝对路径中存在。
 *
 * @param execName 可执行文件名或绝对路径。
 * @returns 程序可访问时返回 true，否则返回 false。
 */
async function isExecutableAvailable(execName: string): Promise<boolean> {
  // 绝对路径直接检测可访问性
  if (path.isAbsolute(execName)) {
    try {
      await fs.access(execName)
      return true
    } catch {
      return false
    }
  }

  // 遍历 PATH 目录寻找对应二进制文件
  const envPath = process.env.PATH || ''
  const dirs = envPath.split(':').filter(Boolean)
  for (const dir of dirs) {
    try {
      await fs.access(path.join(dir, execName))
      return true
    } catch {
      // 遍历下一候选目录
    }
  }

  return false
}

/**
 * 扫描指定目录下的所有 .desktop 文件（含符号链接）。
 *
 * @param dirPath 目标应用目录路径。
 * @returns 符合条件的 .desktop 文件绝对路径列表。
 */
async function scanDesktopDir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    // 支持 Flatpak 导出的符号链接 .desktop 文件
    return entries
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.desktop'))
      .map((e) => path.join(dirPath, e.name))
  } catch {
    return []
  }
}

/**
 * 将单个 .desktop 文件转换为 Command 对象。
 *
 * @param desktopPath .desktop 文件路径。
 * @returns Command 对象；不满足显示条件或解析失败时返回 null。
 */
async function parseDesktopFileToCommand(desktopPath: string): Promise<Command | null> {
  try {
    const content = await fs.readFile(desktopPath, 'utf-8')
    const entry = parseDesktopFile(content)

    const isTrue = (val?: string): boolean => val?.trim().toLowerCase() === 'true'

    // 过滤非应用条目与隐藏条目
    if (
      entry.Type !== 'Application' ||
      isTrue(entry.NoDisplay) ||
      isTrue(entry.Hidden) ||
      !entry.Exec
    ) {
      return null
    }

    // 桌面环境过滤（OnlyShowIn 与 NotShowIn）
    const currentDesktop = process.env.XDG_CURRENT_DESKTOP?.split(':')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    if (currentDesktop && currentDesktop.length > 0) {
      if (entry.OnlyShowIn) {
        const onlyList = entry.OnlyShowIn.split(';')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
        if (!onlyList.some((env) => currentDesktop.includes(env))) return null
      }
      if (entry.NotShowIn) {
        const notList = entry.NotShowIn.split(';')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
        if (notList.some((env) => currentDesktop.includes(env))) return null
      }
    }

    // TryExec：规范规定对应程序不可用时视为未安装
    if (entry.TryExec && !(await isExecutableAvailable(entry.TryExec.trim()))) {
      return null
    }

    const name = getLocalizedName(entry)
    if (!name) return null

    const exec = cleanExecCommand(entry.Exec)
    if (!exec) return null

    // Terminal=true 需要宿主终端，DBusActivatable=true 需走 D-Bus 激活，两者统一通过 gio launch 启动
    const isTerminal = isTrue(entry.Terminal)
    const isDBus = isTrue(entry.DBusActivatable)
    const launchPath = isTerminal || isDBus ? `gio launch "${desktopPath}"` : exec

    // 检索图标并进行 URL 编码
    let iconUrl: string | undefined
    if (entry.Icon) {
      const iconPath = await findIconPath(entry.Icon)
      if (iconPath) {
        iconUrl = `file://${encodeURI(iconPath)}`
      }
    }

    // 生成搜索别名（英文原名 + GenericName + 拼音首字母）
    const aliases: string[] = []
    const rawEnglishName = entry['Name']?.trim()
    if (rawEnglishName && rawEnglishName !== name) {
      aliases.push(rawEnglishName)
    }

    const genericName = entry.GenericName?.trim()
    if (genericName && genericName !== name && !aliases.includes(genericName)) {
      aliases.push(genericName)
    }

    // 生成缩写
    const acronym = extractAcronym(name) || (rawEnglishName ? extractAcronym(rawEnglishName) : '')

    // 如果名称包含中文，生成拼音首字母加入别名
    if (hasChinese(name)) {
      const pinyinAcronym = extractPinyinAcronym(name)
      if (pinyinAcronym && pinyinAcronym !== acronym) {
        aliases.push(pinyinAcronym)
      }
    }

    return {
      name,
      path: launchPath,
      icon: iconUrl,
      aliases: aliases.length > 0 ? aliases : undefined,
      acronym: acronym || undefined
    }
  } catch {
    return null
  }
}

/**
 * 扫描 Linux 系统上安装的所有应用程序（遵循 XDG 规范与 Flatpak 导出）。
 *
 * @returns 扫描到的应用 Command 对象列表。
 */
export async function scanApplications(): Promise<Command[]> {
  try {
    console.time('[LinuxScanner] 扫描应用')

    const searchPaths = getLinuxApplicationPaths()
    const desktopMap = new Map<string, string>() // desktopId -> filePath

    // 收集所有 .desktop 文件，按搜索路径优先级去重（用户自定义优先覆盖系统预装）
    for (const dirPath of searchPaths) {
      const files = await scanDesktopDir(dirPath)
      for (const file of files) {
        const desktopId = path.basename(file)
        if (!desktopMap.has(desktopId)) {
          desktopMap.set(desktopId, file)
        }
      }
    }

    const uniqueFiles = Array.from(desktopMap.values())
    console.log(`[LinuxScanner] 找到 ${uniqueFiles.length} 个 .desktop 文件`)

    // 并发解析（控制并发上限为 30）
    const tasks = uniqueFiles.map((filePath) => () => parseDesktopFileToCommand(filePath))
    const results = await pLimit(tasks, 30)

    // 过滤解析失败与不可见条目
    const apps = results.filter((cmd): cmd is Command => cmd !== null)

    console.timeEnd('[LinuxScanner] 扫描应用')
    console.log(`[LinuxScanner] 成功加载 ${apps.length} 个应用`)

    return apps
  } catch (error) {
    console.error('[LinuxScanner] 扫描应用失败:', error)
    return []
  }
}
