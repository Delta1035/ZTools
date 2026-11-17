import { execFile } from 'child_process'

/**
 * 检查 Linux 系统是否可以直接执行 FFmpeg。
 * @returns 找到可用系统 FFmpeg 时返回命令名，否则返回 null。
 */
export function findSystemFFmpegPath(): Promise<string | null> {
  if (process.platform !== 'linux') return Promise.resolve(null)

  return new Promise((resolve) => {
    // 用真实版本探测确认命令可执行，避免只依赖 PATH 中的文件名。
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error, stdout) => {
      resolve(!error && stdout.includes('ffmpeg') ? 'ffmpeg' : null)
    })
  })
}
