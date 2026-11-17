/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */

const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_RECENT_FILES = 10
let currentFilePath = null
let currentFileName = ''

/**
 * 生成录制文件名，保持文件名可按时间排序。
 * @returns 当前时间对应的 WebM 文件名。
 */
function buildFileName() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${milliseconds}.webm`
}

/**
 * 读取插件录制文件保存目录。
 * @returns 用户配置的保存目录或系统视频目录。
 */
function getOutputDir() {
  return (
    window.ztools.dbStorage.getItem('output') || window.ztools.getPath('videos') || os.homedir()
  )
}

/**
 * 创建当前录制文件并写入空文件占位。
 * @returns 新建文件的绝对路径。
 */
function newFile() {
  const outputDir = getOutputDir()
  const baseName = buildFileName().replace(/\.webm$/, '')
  let suffix = 0
  do {
    currentFileName = `${baseName}${suffix ? `-${suffix}` : ''}.webm`
    currentFilePath = path.resolve(outputDir, currentFileName)
    suffix += 1
  } while (fs.existsSync(currentFilePath))
  fs.mkdirSync(path.dirname(currentFilePath), { recursive: true })
  fs.writeFileSync(currentFilePath, Buffer.alloc(0))
  return currentFilePath
}

/**
 * 将 MediaRecorder 数据块追加到当前文件。
 * @param data 来自渲染进程的二进制数据。
 * @returns 无返回值。
 * @throws 当前没有活动文件或文件写入失败时抛出错误。
 */
function appendData(data) {
  if (!currentFilePath) throw new Error('当前没有活动录制文件')
  fs.appendFileSync(currentFilePath, Buffer.from(data))
}

/**
 * 关闭当前文件句柄状态，但保留文件本身。
 * @returns 无返回值。
 */
function close() {
  currentFilePath = null
  currentFileName = ''
}

/**
 * 读取最近录制文件列表。
 * @returns 最近录制文件，异常或空值时返回空数组。
 */
function getRecentFiles() {
  const raw = window.ztools.dbStorage.getItem('recentFileList')
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/**
 * 保存一条最近录制文件记录，并限制记录数量。
 * @param item 需要保存的文件记录。
 * @returns 无返回值。
 */
function addRecentFile(item) {
  const list = [
    item,
    ...getRecentFiles().filter((entry) => entry.filepath !== item.filepath)
  ].slice(0, MAX_RECENT_FILES)
  window.ztools.dbStorage.setItem('recentFileList', JSON.stringify(list))
}

/**
 * 保存录屏输出目录。
 * @param directory 新的输出目录。
 * @returns 无返回值。
 */
function setOutputDir(directory) {
  window.ztools.dbStorage.setItem('output', directory)
}

/**
 * 获取目标插件兼容的默认输出格式。
 * @returns 当前保存格式。
 */
function getOutFileFormat() {
  return window.ztools.dbStorage.getItem('outfileFormat') || 'webm'
}

/**
 * 保存目标插件兼容的默认输出格式。
 * @param format 输出格式。
 * @returns 无返回值。
 */
function setOutFileFormat(format) {
  window.ztools.dbStorage.setItem('outfileFormat', format)
}

/**
 * 使用宿主 FFmpeg 将录制文件转换为 MP4。
 * @param inputPath 输入 WebM 文件路径。
 * @returns 转换完成后的 MP4 路径。
 * @throws 宿主 FFmpeg 不可用或转换失败时抛出错误。
 */
async function runFFmpeg(inputPath) {
  const outputPath = inputPath.replace(/\.[^.\\/]+$/, '.mp4')
  await window.ztools.runFFmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-y',
    outputPath
  ])
  return outputPath
}

/**
 * 使用宿主 FFmpeg 将录制文件转换为 GIF。
 * @param inputPath 输入 WebM 文件路径。
 * @returns 转换完成后的 GIF 路径。
 * @throws 宿主 FFmpeg 不可用或转换失败时抛出错误。
 */
async function convert2Gif(inputPath) {
  const outputPath = inputPath.replace(/\.[^.\\/]+$/, '.gif')
  await window.ztools.runFFmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    'fps=1',
    '-y',
    outputPath
  ])
  return outputPath
}

// 为目标插件保留旧 API 名称，后续只需替换宿主适配层即可复用原 UI。
window.utools = window.ztools
window.getOutFileFormat = getOutFileFormat
window.setOutFileFormat = setOutFileFormat
window.runFFmpeg = runFFmpeg
window.convert2Gif = convert2Gif

window.mediaFile = {
  newFile,
  appendData,
  close,
  getCurrentPath: () => currentFilePath,
  getOutputDir,
  setOutputDir,
  getRecentFiles,
  addRecentFile,
  getMediaFilePath: () => currentFilePath,
  getMediaFileName: () => currentFileName,
  NewMediaFile: newFile,
  WriteMediaFile: appendData,
  CloseMediaFile: close,
  getRecentFilelist: getRecentFiles,
  addToRecentFilelist: addRecentFile,
  Buffer
}
