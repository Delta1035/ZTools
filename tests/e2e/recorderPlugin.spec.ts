import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const pluginRoot = path.join(projectRoot, 'plugins/recorder')
const pluginConfigPath = path.join(pluginRoot, 'public/plugin.json')
const pluginUrl = 'http://127.0.0.1:5178'

let pluginServer: ChildProcess | null = null

/**
 * 等待录屏插件开发服务器开始响应。
 * @returns 开发服务器可访问后结束的 Promise。
 * @throws 等待超过限制时抛出错误。
 */
async function waitForRecorderServer(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(pluginUrl)
      if (response.ok) return
    } catch {
      // 开发服务器尚未启动，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('录屏插件开发服务器启动超时')
}

/**
 * 在设置插件上下文执行 JavaScript。
 * @param electronApp Playwright Electron 应用实例。
 * @param script 需要执行的 JavaScript 表达式。
 * @returns 设置插件返回的值。
 * @throws 找不到设置插件时抛出错误。
 */
async function executeSettings(electronApp: ElectronApplication, script: string): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, source) => {
    const contents = webContents
      .getAllWebContents()
      .find((item: Electron.WebContents) => item.getURL().startsWith('http://127.0.0.1:15177'))
    if (!contents) return null
    return contents.executeJavaScript(source)
  }, script)
}

/**
 * 在录屏插件上下文执行 JavaScript。
 * @param electronApp Playwright Electron 应用实例。
 * @param script 需要执行的 JavaScript 表达式。
 * @returns 录屏插件返回的值。
 * @throws 找不到录屏插件时抛出错误。
 */
async function executeRecorder(electronApp: ElectronApplication, script: string): Promise<unknown> {
  return electronApp.evaluate(
    async ({ webContents }, { source, url }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item: Electron.WebContents) => item.getURL().startsWith(url))
      if (!contents) return null
      return contents.executeJavaScript(source)
    },
    { source: script, url: pluginUrl }
  )
}

test.describe('录屏插件', () => {
  test.beforeAll(async () => {
    const viteBinary = path.join(pluginRoot, 'node_modules/.bin/vite')
    pluginServer = spawn(viteBinary, ['--host', '127.0.0.1', '--port', '5178', '--strictPort'], {
      cwd: pluginRoot,
      stdio: 'ignore'
    })
    await waitForRecorderServer()
  })

  test.afterAll(() => {
    pluginServer?.kill('SIGTERM')
    pluginServer = null
  })

  test('通过真实 ZTools 宿主加载插件并调用桌面捕获与 FFmpeg 链路', async () => {
    test.setTimeout(60_000)
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-recorder-e2e-'))
    const legacyRoot = path.join(dataRoot, 'legacy')
    let electronApp: ElectronApplication | null = null

    await fs.mkdir(legacyRoot, { recursive: true })
    try {
      // 使用隔离数据目录启动源码 Electron，避免读写用户真实插件数据。
      electronApp = await electron.launch({
        args: [projectRoot],
        cwd: projectRoot,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] =>
              Boolean(entry[1])
            )
          ),
          ZTOOLS_DATA_ROOT: dataRoot,
          ZTOOLS_E2E: '1',
          ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
          ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
        }
      })

      const page = await electronApp.firstWindow()
      const searchInput = page.locator('.search-input')
      await expect(searchInput).toBeVisible()
      await searchInput.fill('通用设置')
      await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
      await expect
        .poll(() => executeSettings(electronApp!, 'document.body.innerText'))
        .toContain('开机自动启动')

      const imported = await executeSettings(
        electronApp,
        `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`
      )
      expect(imported).toMatchObject({ success: true, pluginName: 'ztools-recorder' })
      expect(
        await executeSettings(
          electronApp,
          `window.ztools.internal.installDevPlugin('ztools-recorder')`
        )
      ).toMatchObject({
        success: true
      })

      const plugins = (await executeSettings(
        electronApp,
        'window.ztools.internal.getAllPlugins()'
      )) as Array<{
        name?: string
        path?: string
        isDevelopment?: boolean
      }>
      const recorder = plugins.find(
        (plugin) => plugin.name === 'ztools-recorder__dev' && plugin.isDevelopment
      )
      expect(recorder?.path).toBeTruthy()

      const launched = await executeSettings(
        electronApp,
        `window.ztools.internal.launch({path: ${JSON.stringify(recorder?.path)}, type: 'plugin', name: '录屏', param: {payload: '', type: 'text', code: 'recorder'}})`
      )
      expect(launched).toMatchObject({ success: true })
      await expect
        .poll(() => executeRecorder(electronApp!, 'document.body.innerText'))
        .toContain('开始录制')

      const captureResult = (await executeRecorder(
        electronApp,
        `window.ztools.desktopCaptureSources({types: ['screen', 'window'], thumbnailSize: {width: 0, height: 0}, fetchWindowIcons: false}).then((sources) => ({count: sources.length, hasScreen: sources.some((source) => source.id.startsWith('screen:'))}))`
      )) as { count: number; hasScreen: boolean }
      expect(captureResult.count).toBeGreaterThan(0)
      expect(captureResult.hasScreen).toBe(true)

      const ffmpegResult = await executeRecorder(
        electronApp,
        `window.ztools.runFFmpeg(['-version']).then(() => 'ok')`
      )
      expect(ffmpegResult).toBe('ok')

      const outputDir = path.join(dataRoot, 'videos')
      await fs.mkdir(outputDir, { recursive: true })
      await expect
        .poll(
          () =>
            executeRecorder(
              electronApp!,
              `(() => { const button = document.querySelector('.ant-btn-primary.ant-btn-dangerous'); return Boolean(button && !button.disabled) })()`
            ),
          { timeout: 10_000 }
        )
        .toBe(true)
      await executeRecorder(
        electronApp,
        `(async () => { window.mediaFile.setOutputDir(${JSON.stringify(outputDir)}); document.querySelector('.ant-btn-primary.ant-btn-dangerous')?.click(); return true })()`
      )
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const startState = await executeRecorder(
        electronApp,
        `({ currentPath: window.mediaFile.getCurrentPath(), status: document.querySelector('.status')?.innerText })`
      )
      expect(String((startState as { currentPath?: string })?.currentPath)).toBeTruthy()
      expect(String((startState as { status?: string })?.status)).toContain('录制中')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await executeRecorder(
        electronApp,
        `document.querySelector('.ant-btn-primary.ant-btn-dangerous')?.click(); true`
      )
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await expect
        .poll(() => executeRecorder(electronApp!, 'document.querySelector(".status")?.innerText'))
        .toBe('未录制')
      let savedPath = ''
      await expect
        .poll(
          async () => {
            savedPath = String(
              await executeRecorder(
                electronApp!,
                'window.mediaFile.getRecentFiles()[0]?.filepath || ""'
              )
            )
            return savedPath
          },
          { timeout: 10_000 }
        )
        .toBeTruthy()
      expect(savedPath).toBeTruthy()
      const recordedFile = await fs.stat(String(savedPath))
      expect(recordedFile.size).toBeGreaterThan(0)

      const compatibility = await executeRecorder(
        electronApp,
        `({ utoolsAlias: window.utools === window.ztools, hasLegacyMediaFile: typeof window.mediaFile.NewMediaFile === 'function', hasLegacyFfmpeg: typeof window.runFFmpeg === 'function' })`
      )
      expect(compatibility).toEqual({
        utoolsAlias: true,
        hasLegacyMediaFile: true,
        hasLegacyFfmpeg: true
      })

      const convertedPath = String(
        await executeRecorder(
          electronApp,
          `window.runFFmpeg(${JSON.stringify(savedPath)}).then((filepath) => filepath)`
        )
      )
      expect(convertedPath).toMatch(/\.mp4$/)
      const convertedFile = await fs.stat(convertedPath)
      expect(convertedFile.size).toBeGreaterThan(0)
      await executeRecorder(electronApp, 'window.ztools.showMainWindow(); true')
    } finally {
      if (electronApp) {
        // 录屏会隐藏宿主窗口，退出前显式请求 app.quit，避免 Electron 等待隐藏视图。
        await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
        await Promise.race([
          electronApp.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 5000))
        ])
        if (electronApp.process().exitCode === null) electronApp.process().kill('SIGKILL')
      }
      await fs.rm(dataRoot, { recursive: true, force: true })
    }
  })
})
