/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { constants as zlibConstants, createBrotliCompress } from 'node:zlib'
import * as asar from '@electron/asar'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_DIR = path.join(ROOT_DIR, 'plugins', 'recorder')
const DIST_DIR = path.join(PLUGIN_DIR, 'dist')

/**
 * 解析录屏插件发布命令的参数。
 * @param argv 命令行参数，不包含 Node 和脚本路径。
 * @returns 解析后的发布选项。
 * @throws 参数名称未知或参数值缺失时抛出错误。
 */
function parseArguments(argv) {
  const options = {
    outputPath: '',
    skipBuild: false,
    version: ''
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--skip-build') {
      options.skipBuild = true
      continue
    }
    if (argument === '--version' || argument === '-v') {
      const version = argv[index + 1]
      if (!version) throw new Error(`${argument} 缺少版本号`)
      options.version = version
      index += 1
      continue
    }
    if (argument === '--output' || argument === '-o') {
      const outputPath = argv[index + 1]
      if (!outputPath) throw new Error(`${argument} 缺少输出路径`)
      options.outputPath = outputPath
      index += 1
      continue
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    throw new Error(`不支持的参数: ${argument}`)
  }

  return options
}

/**
 * 执行插件构建命令并透传终端输出。
 * @param command 要执行的命令。
 * @param args 命令参数。
 * @returns 命令成功完成后的 Promise。
 * @throws 子进程启动失败或返回非零退出码时抛出错误。
 */
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: 'inherit'
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} 执行失败${signal ? `，信号: ${signal}` : `，退出码: ${code}`}`))
    })
  })
}

/**
 * 校验发布目录中的插件入口和静态资源。
 * @param stagingDir 已复制并清理开发字段的临时发布目录。
 * @param pluginConfig 插件配置对象。
 * @returns 校验通过后的 Promise。
 * @throws plugin.json 或其声明的入口文件缺失时抛出错误。
 */
async function validatePackageContents(stagingDir, pluginConfig) {
  if (pluginConfig.name !== 'ztools-recorder') {
    throw new Error(
      `plugin.json name 必须是 ztools-recorder，当前为: ${pluginConfig.name || '(空)'}`
    )
  }
  if (!pluginConfig.version) throw new Error('plugin.json 缺少 version 字段')
  if (!pluginConfig.main) throw new Error('plugin.json 缺少 main 字段')

  const requiredFiles = ['plugin.json', pluginConfig.main]
  for (const field of ['preload', 'logo']) {
    if (pluginConfig[field]) requiredFiles.push(pluginConfig[field])
  }

  for (const relativePath of requiredFiles) {
    if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
      throw new Error(`插件文件路径不安全: ${relativePath}`)
    }
    try {
      await fs.access(path.join(stagingDir, relativePath))
    } catch {
      throw new Error(`插件包缺少文件: ${relativePath}`)
    }
  }
}

/**
 * 将已构建的录屏插件目录打包为 ZTools 标准 ZPX 文件。
 * @param options 发布选项。
 * @returns 生成的 ZPX 文件绝对路径。
 * @throws 构建、校验或压缩过程失败时抛出错误。
 */
async function packageRecorder(options) {
  const distPluginJsonPath = path.join(DIST_DIR, 'plugin.json')
  const sourceConfig = JSON.parse(await fs.readFile(distPluginJsonPath, 'utf8'))
  const version = options.version || sourceConfig.version
  if (!version || /[\\/]/.test(version)) throw new Error(`无效的插件版本号: ${version || '(空)'}`)

  const outputPath = path.resolve(
    ROOT_DIR,
    options.outputPath ||
      path.join('plugins', 'recorder', 'release', `ztools-recorder-v${version}.zpx`)
  )
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-recorder-package-'))
  const stagingDir = path.join(temporaryRoot, 'plugin')
  const asarPath = path.join(temporaryRoot, 'plugin.asar')

  try {
    // 复制构建产物，确保正式包不携带源码和 node_modules。
    await fs.cp(DIST_DIR, stagingDir, { recursive: true })

    // 释放包必须走本地 index.html，不能继续指向开发服务器。
    const releaseConfigPath = path.join(stagingDir, 'plugin.json')
    const releaseConfig = JSON.parse(await fs.readFile(releaseConfigPath, 'utf8'))
    delete releaseConfig.development
    releaseConfig.version = version
    await fs.writeFile(releaseConfigPath, `${JSON.stringify(releaseConfig, null, 2)}\n`, 'utf8')
    await validatePackageContents(stagingDir, releaseConfig)

    // 先生成 ASAR，再使用与宿主一致的 Brotli 质量压缩为 ZPX。
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await asar.createPackage(stagingDir, asarPath)
    await pipeline(
      createReadStream(asarPath),
      createBrotliCompress({
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 }
      }),
      createWriteStream(outputPath)
    )

    const outputStat = await fs.stat(outputPath)
    if (outputStat.size === 0) throw new Error('生成的 ZPX 文件为空')
    return outputPath
  } finally {
    // 临时目录只保存中间产物，发布包已写入用户指定的位置。
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  }
}

/**
 * 执行录屏插件的构建和打包流程。
 * @returns 打包完成后结束的 Promise。
 */
async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(`用法: pnpm package:recorder -- [选项]

选项:
  --version, -v <version>  覆盖发布包内的版本号
  --output, -o <path>      指定 .zpx 输出路径
  --skip-build             复用已有的 plugins/recorder/dist
  --help, -h               显示帮助
`)
    return
  }

  if (!options.skipBuild) {
    const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    await runCommand(pnpmCommand, ['--dir', 'plugins/recorder', 'typecheck'])
    await runCommand(pnpmCommand, ['--dir', 'plugins/recorder', 'build'])
  }

  const outputPath = await packageRecorder(options)
  console.log(`录屏插件打包完成: ${outputPath}`)
}

main().catch((error) => {
  console.error(`录屏插件打包失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
