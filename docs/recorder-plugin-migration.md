# 录屏插件迁移总结与后续方案

## 结论

当前录屏插件以 `DogeVenci/utools-recorder` 为基础迁移到 ZTools，录制、文件写入、FFmpeg 转换和全局指令链路已经接通，但界面已经偏离目标插件，平台能力也散落在页面逻辑中。

后续迁移应遵循两层适配模型：

1. 宿主兼容层：把 uTools API 映射到 ZTools API，使目标插件的 preload 和业务代码尽量不用改。
2. 业务适配层：向录屏业务提供稳定的 `RecorderRuntime`，将捕获源、文件写入、转换、存储、生命周期和平台能力集中管理。

UI 应优先复用目标插件，不再为每个插件重新设计一套页面。Vue、Pinia 和 Ant Design Vue 已经与目标插件兼容，迁移重点应放在 API 边界，而不是重新编排界面。

## 当前改动

### 插件功能

- 新增 `plugins/recorder` 独立插件。
- 使用 `desktopCaptureSources` 获取屏幕和窗口。
- 使用 `getUserMedia` 创建桌面视频流，并按设置合并麦克风音轨。
- 使用 `MediaRecorder` 分段录制 WebM。
- 通过插件 preload 的文件桥接追加写入录制文件。
- 使用宿主 `runFFmpeg` 将 WebM 转换为 MP4 或 GIF。
- 支持输出目录、最近文件、录制延迟、暂停恢复和全局指令。

### 宿主改动

- 插件主视图的宿主 preload 和插件 preload 都通过共享 Session 注册。
- `WebContentsView` 不再直接设置插件 preload。
- Linux 优先使用 PATH 中的系统 FFmpeg；找不到时提示安装 `ffmpeg`。
- 增加真实 Electron E2E，验证捕获源、FFmpeg 和 WebM 文件写入链路。

### 本轮继续落地

- 新增 `plugins/recorder/src/runtime.ts`，集中封装平台能力、桌面捕获、文件桥接、存储、转换、生命周期和系统 Shell 调用。
- 页面恢复为目标插件的紧凑工具栏、录制源选择、音频按钮和预览结构。
- 插件 preload 增加旧版 `window.utools`、`mediaFile`、`runFFmpeg` 和格式转换别名，便于直接复用目标插件 UI。
- 修复切换音频源时的失败回滚、MediaRecorder 错误收尾、插件销毁清理和录制文件名冲突。
- E2E 增加兼容别名检查和真实 MP4 转换文件断言。

### UI 严格还原目标插件

对比原版 `DogeVenci/utools-recorder` 的真实渲染结果后，发现上一版界面被重新设计过，与目标插件差异明显。本轮按"复用目标插件页面"的原则还原：

- 从原版移植 5 个自定义 SVG 图标组件：`RecordIcon`（红色圆点）、`StopIcon`（红色方块）、`PauseIcon`（双竖条）、`PlayIcon`（蓝色三角）、`OpenIcon`（外链箭头），替换原先的 Ant Design 通用图标。
- 录制按钮恢复为默认按钮 + 红色圆点图标，不再使用 `danger` 实心样式。
- 系统声音与麦克风按钮恢复为图标按钮，移除「系统声」「麦克风」文字。
- 预览区恢复白底与自然高度，移除黑色底板、空状态文案和倒计时遮罩。
- 移除底部新增的平台／格式／输出路径信息栏。
- 录制源下拉框恢复 `width-20`（320px）固定宽度，选项图标改用 `a-image` 渲染。
- 设置弹窗恢复 `full-modal` 全屏遮罩形态与「设置」标题，格式选项简化为 WEBM／MP4／GIF。
- 状态提示文案恢复原版英文表述（`Recording`／`Paused`／`Start record after Ns`）。
- 原版 `less` 嵌套样式改写为等价原生 CSS，避免为插件引入 `less` 依赖。

还原只涉及 `App.vue` 与 `components/Setting.vue`，`runtime.ts`、`recorder.ts`、`store.ts`、`timer.ts`、`convert.ts` 逻辑层零改动。

### 目标插件的迁移映射

| 目标插件能力                   | 当前 ZTools 调用               |
| ------------------------------ | ------------------------------ |
| `utools.desktopCaptureSources` | `ztools.desktopCaptureSources` |
| `utools.dbStorage`             | `ztools.dbStorage`             |
| `utools.getPath`               | `ztools.getPath`               |
| `utools.showOpenDialog`        | `ztools.showOpenDialog`        |
| `utools.shellOpenPath`         | `ztools.shellOpenPath`         |
| `utools.shellShowItemInFolder` | `ztools.shellShowItemInFolder` |
| `utools.shellBeep`             | `ztools.shellBeep`             |
| `utools.onPluginEnter`         | `ztools.onPluginEnter`         |
| `utools.hideMainWindow`        | `ztools.hideMainWindow`        |
| 原插件 WASM FFmpeg             | `ztools.runFFmpeg`             |

## 本轮已修正的问题

- 通过平台能力矩阵统一处理 Windows、macOS 和 Linux 的系统声音开关。
- 恢复 Windows 首次运行默认开启系统声音的目标插件行为。
- 统一 MediaRecorder 错误、切流失败和插件销毁时的资源收尾。
- 转换期间锁定录制和设置操作。
- 录制文件名增加毫秒和冲突序号，避免覆盖同一秒内的文件。
- 共享 Session 的 preload 按稳定作用域替换旧路径，避免插件升级后旧、新脚本同时执行。

## 仍需继续修正的问题

1. 当前 E2E 已增加真实 MP4 输出断言，但仍没有覆盖 GIF、暂停恢复和录制异常恢复。
2. `plugins/recorder` 尚未接入正式插件发布或内置插件构建流程，需要明确它是示例插件、开发插件还是随 ZTools 发布。

## 适配层设计

业务代码应依赖如下领域接口，而不是直接依赖 `window.ztools`：

```ts
interface RecorderRuntime {
  platform: {
    os: 'windows' | 'macos' | 'linux'
    capabilities: {
      systemAudio: boolean
      microphone: boolean
      desktopCapture: boolean
      ffmpeg: boolean
    }
  }
  capture: {
    listSources(): Promise<CaptureSource[]>
    createStream(
      source: CaptureSource,
      options: { microphone: boolean; systemAudio: boolean }
    ): Promise<MediaStream>
  }
  files: {
    create(): string
    append(data: Uint8Array): void
    close(): void
    getRecent(): RecentFile[]
    addRecent(file: RecentFile): void
  }
  conversion: {
    toMp4(inputPath: string): Promise<string>
    toGif(inputPath: string): Promise<string>
  }
  storage: {
    get<T>(key: string): T | null
    set<T>(key: string, value: T): void
  }
  lifecycle: {
    onEnter(callback: (payload: PluginEnterPayload) => void): Promise<void>
    hideMainWindow(): Promise<void>
    showMainWindow(): boolean
  }
}
```

### 宿主兼容层

本轮先在录屏插件 preload 中提供兼容桥；后续应将它提取为显式开启的通用 uTools 兼容模式，将以下旧接口映射到 ZTools：

- `window.utools = window.ztools` 的基础 API 别名。
- `window.runFFmpeg(filepath)` 和 `window.convert2Gif(filepath)`。
- `mediaFile.NewMediaFile`、`WriteMediaFile`、`CloseMediaFile` 等原始方法名。
- `getOutFileFormat` 和 `setOutFileFormat`。

通用兼容模式建议通过 manifest 声明，避免所有插件默认暴露旧 API。

### 业务适配层

录屏 UI 和状态机只调用 `RecorderRuntime`。ZTools、uTools 或浏览器测试环境分别实现自己的 Runtime Adapter。后续移植插件时只需新增适配器，不需要复制和修改整套 UI。

## 推荐实施顺序

1. 保留目标插件的页面结构、样式和交互。
2. 增加 uTools 兼容层，减少目标插件源代码改动。
3. 增加 `RecorderRuntime`，把 ZTools API 集中到适配层。
4. 用平台能力矩阵替代散落的 `isLinux`、`isWindows` 判断。
5. 修复录制错误、切流失败、销毁清理和文件名冲突。
6. 增加真实 MP4/GIF 转换 E2E，以及暂停恢复和异常恢复回归。
7. 明确插件的发布方式，再补充插件构建和打包脚本。

## 验证记录

- 主项目 Node 类型检查通过。
- 录屏插件类型检查通过。
- 录屏插件 Vite 构建通过。
- `git diff --check` 通过。
- Electron E2E 在当前环境因缺少 `$DISPLAY`，在 Electron 启动阶段报 `Missing X server or $DISPLAY`，没有进入插件断言；新增的 MP4 断言尚未获得真实 Electron 运行结果。
- 根目录 lint 存在原有错误，同时新增的 CommonJS preload 也需要单独配置 lint 规则。
- UI 还原后，录屏插件目录 `eslint` 检查为 0 error、0 warning。
- 通过 Playwright + Chromium 对原版与还原版做同条件渲染截图比对，工具栏区域像素差异为 5.31%；差异集中于音频按钮的激活态，源于原版依赖 `utools.onPluginReady` 初始化默认值、还原版在 `loadSettings` 中初始化，真实环境下两者行为一致。
- `vitest` 全量测试结果与改动前基线一致（90 passed / 5 failed，失败项均为 `windowsScanner` 等主进程历史问题，与本插件无关）。
