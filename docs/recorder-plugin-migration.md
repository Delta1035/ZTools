# 录屏插件迁移总结与后续方案

## 结论

录屏插件采用**原样移植**：`plugins/recorder/src` 直接使用 `DogeVenci/utools-recorder` 的源码，
不重写页面、不改样式、不换组件库版本，只在 preload 中做一层 uTools → ZTools 的宿主兼容。

这个结论是踩过坑之后定下来的。此前尝试过"用新的组件库重画一套同样的界面"，
结果是框架版本不同（Ant Design Vue 3 → 4）、样式引入方式不同（less 按需引入 → 手写 CSS），
视觉永远对不上，反复微调也无法收敛。

正确的做法只有一条：**同一个 UI 就用同一份源码、同一套依赖、同一套样式管线。**

## 当前实现

### 源码

`plugins/recorder/src` 与上游仓库保持同构，没有任何本地改写：

```text
src/
├── main.js                     # 入口：createApp + pinia + antd notification 样式
├── store.js                    # Pinia store（状态、videoOptions、hasSysAudio 等 getter）
├── App.vue                     # 工具栏 + 预览区，样式为 less
├── assets/
│   ├── recorder.js             # MediaRecorder 采集与写入
│   ├── plugin.js               # onPluginReady / onPluginEnter / onPluginOut
│   ├── convert.js              # 格式转换调度
│   └── timer.js                # 录制计时与倒计时
└── components/
    ├── RecordIcon.vue  StopIcon.vue  PauseIcon.vue  PlayIcon.vue  OpenIcon.vue
    ├── Setting.vue             # full-modal 全屏设置
    └── NotificationButton.vue  # 保存成功通知里的「打开」按钮
```

### 依赖版本

锁定为上游 `package-lock.json` 的精确版本，不用 semver 范围：

| 依赖                    | 版本   |
| ----------------------- | ------ |
| ant-design-vue          | 3.2.20 |
| @ant-design/icons-vue   | 6.1.0  |
| vue                     | 3.5.45 |
| pinia                   | 2.3.1  |
| less                    | 4.9.1  |
| vite                    | 4.5.14 |
| @vitejs/plugin-vue      | 4.6.2  |
| unplugin-vue-components | 0.24.1 |

### 构建配置

`vite.config.ts` 与上游语义一致，只把 `base` 改为相对路径以适配 asar 内加载：

- `unplugin-vue-components` + `AntDesignVueResolver()`：**antd 组件与其 less 样式按需自动引入**。
  这是原版样式的真正来源，绝对不能换成手写 CSS。
- `css.preprocessorOptions.less.javascriptEnabled = true`：antd 3 的 less 变量需要它。
- `base: './'`：插件从 asar 加载，资源必须相对引用。

### 宿主兼容层

`plugins/recorder/public/preload.cjs` 负责把 uTools API 映射到 ZTools：

- `window.utools = window.ztools`；
- `window.mediaFile`：`NewMediaFile` / `WriteMediaFile` / `CloseMediaFile` /
  `getMediaFilePath` / `getMediaFileName` / `getOutputDir` / `setOutputDir` /
  `getRecentFilelist` / `addToRecentFilelist` / `Buffer`；
- `window.runFFmpeg` / `window.convert2Gif`：走宿主 FFmpeg，替代原插件的 WASM FFmpeg；
- `window.getOutFileFormat` / `window.setOutFileFormat`；
- `onPluginReady` 语义修正（见下）。

## onPluginReady 的语义差异

uTools 中 `onPluginReady`（插件就绪）和 `onPluginEnter`（插件被唤起）是**两个独立事件**。
ZTools 目前把 `onPluginReady` 也映射到同一个进入回调：

```js
// resources/preload.js
onPluginReady: async (callback) => {
  enterCallback = callback
  replayPendingPluginEnterIfNeeded()
}
```

后果是：目标插件先注册 `onPluginReady`（初始化音频源、延迟、输出格式），
再注册 `onPluginEnter`（处理全局指令），**后注册会把前一个覆盖掉**，
初始化回调可能永远不执行，表现为音频按钮不亮、输出格式为空。

兼容层因此恢复独立语义，且不影响 `onPluginEnter`：

```js
window.ztools.onPluginReady = (callback) => {
  if (typeof callback === 'function') {
    setTimeout(() => callback(), 0)
  }
  return Promise.resolve()
}
```

后续应在宿主层面把 `onPluginReady` 与 `onPluginEnter` 拆成两个独立回调槽，
再删掉插件里的这段兜底。

## 目标插件的迁移映射

| 目标插件能力                   | 当前 ZTools 调用               | 说明                    |
| ------------------------------ | ------------------------------ | ----------------------- |
| `utools.desktopCaptureSources` | `ztools.desktopCaptureSources` | 同名直通                |
| `utools.dbStorage`             | `ztools.dbStorage`             | 完全兼容                |
| `utools.getPath`               | `ztools.getPath`               | 同名直通                |
| `utools.showOpenDialog`        | `ztools.showOpenDialog`        | 同名直通                |
| `utools.shellOpenPath`         | `ztools.shellOpenPath`         | Linux 目录打开已修正    |
| `utools.shellBeep`             | `ztools.shellBeep`             | 同名直通                |
| `utools.onPluginEnter`         | `ztools.onPluginEnter`         | 同名直通                |
| `utools.onPluginReady`         | 兼容层覆写为独立就绪回调       | 见上一节                |
| `utools.setSubInput`           | `ztools.setSubInput`           | 同名直通                |
| `utools.hideMainWindow`        | `ztools.hideMainWindow`        | 同名直通                |
| 原插件 WASM FFmpeg             | `ztools.runFFmpeg`             | 用宿主 FFmpeg 替代 WASM |

## 本轮已修正的问题

- 界面改为原样移植，与目标插件 CSS 产物逐字节一致（见验证记录）。
- 修复 `onPluginReady` 被 `onPluginEnter` 覆盖导致初始化不执行的问题。
- 修复 Linux 下「打开录像目录」跳到非文件管理器程序的问题。
- E2E 选择器改为 `#switchBtn` 与 `.ant-select.width-20`，状态文案断言改为 `Recording`。

## Linux 打开目录被劫持的问题

现象：在 Linux 上点击工具栏的「打开录像目录」，或录制保存后自动定位文件时，
打开的却是 Antigravity（IDE）而不是文件管理器。

根因：宿主把目录打开交给 Electron 的 `shell.openPath()`，Linux 下它等价于 `xdg-open`，
会遵循 `mimeapps.list` 的默认关联。而部分应用会把 `inode/directory` 注册进自己的
`MimeType`（Antigravity 就是这样注册的），于是目录的默认打开程序变成了 IDE。

修复：目录类路径不再走 `xdg-open`，改为直接启动系统文件管理器
（`src/main/utils/linuxFileManager.ts`，按 nautilus / dolphin / thunar / nemo /
pcmanfm / caja / konqueror 顺序探测），没有可用文件管理器时才回退到系统默认方式。

该修复覆盖三处调用：

- `src/main/api/plugin/shell.ts` 的 `shell-open-path`：录屏插件「打开录像目录」走这里；
- `src/main/api/plugin/shell.ts` 的 `shell-show-item-in-folder`：录制保存后定位文件走这里；
- `src/main/api/renderer/systemCommands.ts` 的「前往文件夹」系统命令。

## 仍需继续修正的问题

1. E2E 尚未覆盖 GIF 转换、暂停恢复和录制异常恢复。
2. 宿主应把 `onPluginReady` 与 `onPluginEnter` 拆成独立回调，之后可删除插件 preload 的兜底实现。
3. 插件源码与上游同步需要流程支撑：上游更新后应能明确「重新同步哪些文件」，
   目前是靠人工比对整个 `src/`。

## 验证记录

- 录屏插件 Vite 构建通过；产物 CSS 与上游 `dist/assets/index-a7643e0f.css`
  **md5 完全一致**（`50431d6a187d2d842b7933bd3a426daf`），证明样式管线与样式内容相同。
- 主项目类型检查（`typecheck:node` + `typecheck:web`）通过。
- 对改动文件执行 `eslint`，0 error、0 warning。
- 通过 Playwright + Chromium 对上游构建产物与本地产物做同条件渲染（900×560，同一份宿主 stub）：
  - 主界面整幅差异 **58 / 504000 = 0.012%**；
  - 设置弹窗整幅差异 **58 / 504000 = 0.012%**；
  - 差异像素集中在右上角关闭图标，是上游已提交 dist 与当前源码重建之间的 1px 位置差，
    不是样式差异。
- Electron E2E 在当前环境因缺少 `$DISPLAY`（`Missing X server or $DISPLAY`）无法运行，
  选择器与断言已按新界面更新，尚无真实 Electron 运行结果。
- `vitest` 全量结果与改动前基线一致（失败项均为 `windowsScanner` 等主进程历史问题，与本插件无关）。
