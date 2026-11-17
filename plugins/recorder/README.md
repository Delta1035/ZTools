# ZTools 录屏插件

基于 `DogeVenci/utools-recorder` 迁移到 ZTools 的独立插件。

## 功能

- 录制屏幕或指定窗口
- 开始、停止、暂停和恢复录制
- 麦克风录音
- 保存为 WebM，使用 ZTools FFmpeg 转换为 MP4 或 GIF
- 自定义输出目录和开始前延迟
- 支持 ZTools 全局快捷指令

## 开发

```bash
pnpm install
pnpm dev
pnpm build
```

在 ZTools 的开发插件设置中导入本目录的 `public/plugin.json`，然后以开发模式启动插件。

Linux 下系统声音开关不可用；麦克风录音是否可用取决于桌面会话的音频权限。MP4/GIF 转换使用宿主提供的 FFmpeg。

原始项目作者为 Dovenci，上游项目声明 MIT 许可：`https://github.com/DogeVenci/utools-recorder`。
