import { recorderRuntime } from './runtime'
import type { OutputFormat } from './types'

/**
 * 使用 ZTools FFmpeg API 转换录制文件。
 * @param inputPath 输入 WebM 文件路径。
 * @param format 目标输出格式。
 * @returns 转换完成后的文件路径。
 * @throws FFmpeg 不可用或转换失败时抛出错误。
 */
export async function convertRecording(inputPath: string, format: OutputFormat): Promise<string> {
  return recorderRuntime.conversion.convert(inputPath, format)
}
