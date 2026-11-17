# ZTools 录屏插件

`DogeVenci/utools-recorder` 到 ZTools 的**原样移植**：`src/` 直接使用上游源码，
不重写页面、不改样式；宿主差异只在 `public/preload.cjs` 的兼容层里处理。

## 功能

- 录制屏幕或指定窗口
- 开始、停止、暂停和恢复录制
- 系统声音与麦克风
- 保存为 WebM，使用 ZTools FFmpeg 转换为 MP4 或 GIF
- 自定义输出目录和开始前延迟
- 支持 ZTools 全局快捷指令

## 开发

```bash
npm install
npm run dev      # 开发服务器 http://127.0.0.1:5178
npm run build    # 产物输出到 dist/
```

在 ZTools 的开发插件设置中导入本目录的 `public/plugin.json`，然后以开发模式启动插件。

## 为什么不做"重画界面"

界面必须与上游保持一致。上游用 Vue 3 + Ant Design Vue 3 + less，
并经 `unplugin-vue-components` 的 `AntDesignVueResolver` 按需引入 antd 样式。
换组件库版本或手写 CSS 都会导致视觉偏差且无法收敛，
因此依赖版本锁定为上游 `package-lock.json` 的精确版本，`src/` 保持原样
（例外：两处把宿主写成 uTools 的字符串已改为 ZTools，见下节）。

这一条不是本插件的个别结论，而是通用移植要求（源码同源、依赖同版本、样式管线一致、
宿主差异只在适配层、只允许改宿主标识文字）的一部分，完整标准与验收清单见
`docs/recorder-plugin-migration.md` 的「移植要求（验收标准）」，后续插件移植照此执行。

## 对上游源码的两处改动

界面和样式零改动，只有两个宿主相关字符串：

| 位置                     | 改动                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `src/assets/plugin.js`   | 子输入框占位文案「可在utools 全局快捷键设置中…」→「可在 ZTools 全局快捷键设置中…」          |
| `src/assets/recorder.js` | 采集源过滤 `name != "uTools"` → 过滤 `["ZTools", "uTools"]`，避免把 ZTools 自身窗口录进画面 |

`utools.xxx` 形式的 API 调用**没有改也不需要改**——它们由 `public/preload.cjs`
的 `window.utools = window.ztools` 别名提供。改掉这些标识符会让插件直接失效。

验证方式：本地产物 CSS 与上游 `dist/assets/index-a7643e0f.css` md5 一致，
同条件渲染截图整幅差异 0.012%。详见 `docs/recorder-plugin-migration.md`。

## 已知平台限制

Linux 下系统声音开关不可用；麦克风录音是否可用取决于桌面会话的音频权限。
MP4/GIF 转换使用宿主提供的 FFmpeg。

原始项目作者为 Dovenci，上游项目声明 MIT 许可：`https://github.com/DogeVenci/utools-recorder`。
