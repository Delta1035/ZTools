import { spawn } from 'child_process'

/**
 * 常见 Linux 桌面环境的文件管理器候选列表。
 * 顺序按发行版使用率排列，命中第一个已安装的程序即停止尝试。
 */
const LINUX_FILE_MANAGER_CANDIDATES = [
  { command: 'nautilus', args: ['--new-window'] },
  { command: 'dolphin', args: [] },
  { command: 'thunar', args: [] },
  { command: 'nemo', args: [] },
  { command: 'pcmanfm', args: [] },
  { command: 'pcmanfm-qt', args: [] },
  { command: 'caja', args: [] },
  { command: 'konqueror', args: [] }
] as const

/**
 * 使用 Linux 文件管理器打开目录，并将失败状态反馈给调用方。
 *
 * 不走 xdg-open：xdg-open 会遵循 mimeapps.list 的默认关联，
 * 而部分应用（如 IDE 类工具）会注册 inode/directory，
 * 导致「打开文件夹」被劫持到非文件管理器程序。
 *
 * @param directoryPath 要打开的目录路径
 * @returns 文件管理器处理完成后结束的 Promise
 * @throws Linux 文件管理器未实现或所有候选程序启动失败时抛出异常
 */
export function openLinuxDirectory(directoryPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let candidateIndex = 0
    let lastError: Error | null = null

    const tryNextFileManager = (): void => {
      const candidate = LINUX_FILE_MANAGER_CANDIDATES[candidateIndex++]
      if (!candidate) {
        reject(
          new Error(`Linux 文件管理器未实现或无法启动${lastError ? `：${lastError.message}` : ''}`)
        )
        return
      }

      const child = spawn(candidate.command, [...candidate.args, directoryPath], {
        detached: true,
        stdio: 'ignore'
      })
      let candidateSettled = false

      // 文件管理器交给桌面会话继续运行，主进程只等待启动结果。
      child.once('spawn', () => {
        if (candidateSettled) return
        candidateSettled = true
        child.unref()
        resolve()
      })

      // 当前候选不存在时继续尝试下一个桌面环境的文件管理器。
      child.once('error', (error) => {
        if (candidateSettled) return
        candidateSettled = true
        lastError = error
        tryNextFileManager()
      })
    }

    tryNextFileManager()
  })
}
