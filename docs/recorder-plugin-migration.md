# 录屏插件迁移总结与后续方案

## 结论

录屏插件采用**原样移植**：`plugins/recorder/src` 直接使用 `DogeVenci/utools-recorder` 的源码，
不重写页面、不改样式、不换组件库版本，只在 preload 中做一层 uTools → ZTools 的宿主兼容。

这个结论是踩过坑之后定下来的。此前尝试过"用新的组件库重画一套同样的界面"，
结果是框架版本不同（Ant Design Vue 3 → 4）、样式引入方式不同（less 按需引入 → 手写 CSS），
视觉永远对不上，反复微调也无法收敛。

正确的做法只有一条：**同一个 UI 就用同一份源码、同一套依赖、同一套样式管线。**

## 移植要求（验收标准）

本节由录屏插件这一轮返工得出，**后续所有 uTools 插件移植都按此执行**，不再逐次讨论。

### 五条硬性要求

| 编号 | 要求                                                                                                                    | 原因                                                                                             | 验收手段                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| R1   | **源码同源**：`src/` 直接使用上游源码，不重写页面、不重绘图标、不重排布局                                               | 观感由「组件库版本 + 样式管线 + 图标实现」三层共同决定，任何一层重写都会产生无法靠微调收敛的偏差 | `diff -r 上游/src 本地/src`，差异只允许出现在白名单文件 |
| R2   | **依赖同版本**：按上游 lock 文件锁精确版本，禁止 `^` / `~` 范围                                                         | antd 3 与 4 的按钮内边距、字号行高、图标尺寸本身就不同，主版本一漂移等于换了设计                 | `package.json` 中所有影响视觉的依赖写成精确版本         |
| R3   | **样式管线一致**：保留上游的样式引入方式（本例：`unplugin-vue-components` + `AntDesignVueResolver` 按需引入 antd less） | 上游 251 KB 的 antd less 才是原版观感的真正来源，手写 CSS 只能做到近似                           | 构建产物 CSS 与上游 `dist/assets/*.css` **md5 一致**    |
| R4   | **宿主差异收敛在适配层**：uTools → ZTools 的差异只写在 `public/preload.cjs`，不侵入上游业务代码                         | 保持上游可同步；出问题只需读一个文件                                                             | 检查 `src/` 里是否出现 `ztools.` 调用                   |
| R5   | **只允许改宿主标识文字**：用户可见的 uTools 文案改为 ZTools                                                             | 界面里写着别的产品名本身就是移植缺陷                                                             | 改动必须落在「宿主文案适配」白名单内，且逐条记录        |

### 明确禁止

- 用更高版本的组件库"重画一套同样的界面"（上一轮的实际错误，重画版与原版整幅像素差 **41.49%**，且反复微调无法收敛）
- 手写 CSS 模拟组件库观感，或用自建样式覆盖 antd 设计变量
- 自造 `runtime` / `store` / `timer` 层替换上游逻辑
- 换掉上游的自绘 SVG 图标（本例的 `RecordIcon` / `StopIcon` / `PauseIcon` / `PlayIcon` / `OpenIcon`）
- 批量把 `utools.xxx` 改成 `ztools.xxx` —— 必须靠 preload 别名兼容，改源码会直接崩

### 验收清单

移植完成的判据，全部满足才算通过：

- [ ] `diff -r` 上游 `src/` 与本地 `src/`，差异仅限白名单（本插件为 2 个文件、3 行）
- [ ] 构建产物 CSS 与上游 md5 相同
- [ ] 同条件渲染（同分辨率 + 同一份宿主 stub）整幅像素差 < 0.1%
- [ ] 主界面、设置弹窗、通知等**所有界面态**都做过比对，不只比首屏
- [ ] 上游调用的宿主 API 全部有对应映射，并逐项写进映射表
- [ ] 构建、lint、类型检查、测试结果与改动前基线一致
- [ ] 文档记录白名单改动，以及残留差异的具体原因（不能只写"基本一致"）

### 存量插件的判断

已移植但不符合上述要求的插件，按「达标 / 需返工」两类处理：
界面被重画过、组件库版本与上游不一致、图标被替换的，一律算需返工，
返工方式就是本文件的 R1–R5，不做局部修补。

## 当前实现

### 源码

`plugins/recorder/src` 与上游仓库保持同构，除下文「宿主文案适配」列出的两处字符串外，没有本地改写：

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

### 宿主文案适配

界面与逻辑不改，但源码里有两处把宿主写成 uTools 的字符串，移植后必须指向 ZTools：

| 位置                     | 上游内容                                                              | 移植后                                                          |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/assets/plugin.js`   | `setSubInput` 占位文案「可在utools 全局快捷键设置中绑定关键字…」      | 「可在 **ZTools** 全局快捷键设置中绑定关键字…」                 |
| `src/assets/recorder.js` | 采集源过滤 `name != "uTools"`，用于把宿主自身窗口从可录窗口列表里剔除 | 过滤 `["ZTools", "uTools"]`，既排除 ZTools 窗口，也保留上游兼容 |

**`window.utools` / `utools.dbStorage` 等 API 标识符一律不动。** 这些调用靠
`public/preload.cjs` 里的 `window.utools = window.ztools` 别名工作，改名会让插件直接报错。
同理，README 里的 `DogeVenci/utools-recorder` 是上游仓库地址，必须保持原样。

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
- 上游文案里的宿主名改为 ZTools：子输入框占位文案、可录窗口过滤名单（见「宿主文案适配」）。
- 修复 `onPluginReady` 被 `onPluginEnter` 覆盖导致初始化不执行的问题。
- 修复 Linux 下「打开录像目录」跳到非文件管理器程序的问题。
- E2E 选择器改为 `#switchBtn` 与 `.ant-select.width-20`，状态文案断言改为 `Recording`。

按「移植要求（验收标准）」逐条对照，本插件已全部满足：源码同源（差异仅 2 文件 3 行）、
依赖精确锁定、样式管线与上游一致（CSS md5 相同）、宿主差异只在 preload、
渲染差异 0.012%（阈值 0.1%）。

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
  改过宿主文案后 CSS 哈希仍然不变（JS 哈希随字符串变化，符合预期）。
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

## 附录：已废弃的历史方案

移植初期（`ce89c76` → `ef6aca3`）文档里有一节「适配层设计」，提出两层模型：

1. **宿主兼容层**：在插件 preload 里把 uTools API 映射到 ZTools；
2. **业务适配层**：定义 `RecorderRuntime` 领域接口
   （`platform` / `capture` / `files` / `conversion` / `storage` / `lifecycle`），
   业务代码只依赖该接口，由 ZTools、uTools、浏览器测试环境各自实现适配器。

这一版方案已删除，因为落地时走了相反的路：为了给 `RecorderRuntime` 供数据，
插件页面被重写成一套「antd 4 + 手写 CSS」的新界面，与原版整幅像素差 41.49% 且无法收敛。

在新方案里：第 1 层保留并演化为 `public/preload.cjs` 的兼容桥（对应 R4）；
第 2 层整体废弃 —— `runtime.ts` / `recorder.ts` / `store.ts` / `timer.ts` / `convert.ts` 均已删除，
业务逻辑回归上游 `src/assets/*.js`（对应 R1：不引入中间层）。

该方案里仍有两条结论成立，可复用到后续插件：

- **通用 uTools 兼容模式**：兼容桥不该每个插件各写一份，建议抽成由 manifest 显式开启的
  通用兼容层，避免所有插件默认暴露旧 API；
- **平台能力矩阵**：用能力矩阵替代散落在各处的 `isLinux` / `isWindows` 判断。

查看被替换掉的完整文字：

```bash
git show ef6aca3:docs/recorder-plugin-migration.md
```
