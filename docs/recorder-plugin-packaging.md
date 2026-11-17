# 录屏插件打包与发布指南

本文说明 `plugins/recorder` 的构建、打包、本地验证和市场发布流程。

## 1. 包格式

正式推荐使用 `.zpx`：

```text
插件目录 -> ASAR -> Brotli 压缩 -> .zpx
```

安装包内部的根目录必须直接包含：

```text
plugin.json
index.html
assets/
logo.png
preload.cjs
```

不能多出一层 `dist/`，也不要把 `src/`、`node_modules/` 或整个工程目录作为发布内容。

ZTools 当前也兼容 `.zip`，但 ZIP 内部同样必须把 `plugin.json` 放在根目录；市场发布优先使用 `.zpx`。

## 2. 发布前检查

修改 [plugins/recorder/public/plugin.json](../plugins/recorder/public/plugin.json) 中的版本号。版本号是插件市场和安装器使用的版本来源，建议使用标准 SemVer，例如 `1.0.0`。

开发配置可以保留在源码 manifest 中：

```json
"development": {
  "main": "http://127.0.0.1:5178"
}
```

但正式包不能保留该字段，否则安装后的插件可能继续访问开发服务器。项目内的打包工具会自动从正式包中删除 `development`。

## 3. 一键打包

在 ZTools 根目录执行：

```bash
pnpm package:recorder
```

该命令会依次执行：

1. `plugins/recorder` 类型检查；
2. Vite 构建；
3. 复制 `dist` 到临时发布目录；
4. 删除正式包中的 `development` 字段；
5. 校验 `plugin.json`、主页面、preload 和 logo；
6. 生成 Brotli 压缩的 `.zpx` 文件。

默认输出路径：

```text
plugins/recorder/release/ztools-recorder-v<version>.zpx
```

指定版本号：

```bash
pnpm package:recorder -- --version 1.0.1
```

指定输出路径：

```bash
pnpm package:recorder -- \
  --version 1.0.1 \
  --output /tmp/ztools-recorder-v1.0.1.zpx
```

如果已经有构建好的 `plugins/recorder/dist`，可以跳过构建：

```bash
pnpm package:recorder -- --skip-build
```

查看帮助：

```bash
pnpm package:recorder -- --help
```

工具实现位于 [scripts/package-recorder.mjs](../scripts/package-recorder.mjs)，根目录命令定义在 [package.json](../package.json)。

## 4. 本地安装验证

在 ZTools 的插件导入入口中选择生成的 `.zpx` 文件，重点验证：

- 插件加载的是包内 `index.html`，而不是 `127.0.0.1:5178`；
- 录制屏幕和指定窗口正常；
- 开始、停止、暂停和恢复正常；
- 麦克风权限和音轨写入正常；
- WebM 文件能写入配置目录；
- MP4 和 GIF 转换正常；
- 全局指令仍然可以进入录屏插件。

Linux 下系统声音开关目前不可用；麦克风能力取决于桌面会话的音频权限。这是当前插件的已知平台限制，不属于打包错误。

## 5. 市场发布

当前仓库已经实现插件市场列表、版本查询、下载和安装，但没有录屏插件的正式上传脚本，也没有客户端内的插件包提交审核入口。市场发布仍需要市场后台或服务端审核流程。

提交时通常需要准备：

- 插件名称：`ztools-recorder`；
- 标题：`录屏`；
- 发布版本；
- 描述、作者和 logo；
- `.zpx` 下载地址；
- 更新日志；
- 分类、支持平台和开源信息。

如果只是私下分发，可以把生成的 `.zpx` 放到 GitHub Release、对象存储或下载服务器，并直接让用户通过本地插件导入安装。

## 6. 相关实现

- [plugins/recorder/public/plugin.json](../plugins/recorder/public/plugin.json)：开发 manifest 和插件元数据；
- [plugins/recorder/vite.config.ts](../plugins/recorder/vite.config.ts)：Vite 输出配置；
- [src/main/utils/zpxArchive.ts](../src/main/utils/zpxArchive.ts)：ZPX 的 ASAR/Brotli 格式实现；
- [src/main/api/renderer/pluginDevProjects.ts](../src/main/api/renderer/pluginDevProjects.ts)：开发项目打包 API；
- [src/main/api/renderer/pluginInstaller.ts](../src/main/api/renderer/pluginInstaller.ts)：ZPX/ZIP 安装逻辑。
