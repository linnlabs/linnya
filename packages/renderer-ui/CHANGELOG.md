# Changelog

本文件记录 `@linnya/renderer-ui` 的公开 JS、CSS、token、主题、overlay 与 scroll 合同变化。

## 2.1.0 - 2026-09-03

- `CustomSelect` 新增可选 `optionLabelOverflow` 合同；`marquee-on-hover` 让长选项默认显示省略号，hover 时仅对真实溢出的文本滚动到末尾，并遵守 reduced-motion；
- 带子菜单项的数量提示由箭头左侧 12px 单边间距改为数字左右各 6px，保持名称、数量和箭头的视觉节奏。

## 2.0.0 - 2026-09-01

- `ActionButtons` 删除 `isGenerating`、`canGenerate` 业务状态和 `isDangerousAction`、`isInfoAction`、
  `isAccentAction` 互斥布尔接口，不提供旧 API 转发；
- 主操作统一使用严格的 `primaryVariant: 'default' | 'danger' | 'accent'`，无真实消费者的 info 视觉合同已删除；
- 调用方显式投影主次按钮 disabled 与 `aria-busy` 等浏览器事实，组件不再理解保存、生成或权限流程；
- 公开 `ActionButtonsProps`、variant、shape、slot 与原生按钮属性类型，并补齐点击、禁用、属性投影和 variant 行为测试；
- Host 与全部官方 renderer 插件原子切换到 `^2.0.0`，旧 `^1.0.0` artifact 在执行 JS/CSS 前拒绝加载。

## 1.0.0 - 2026-09-01

首个稳定版本：

- 建立基础控件、图标、本地化、主题、token、overlay layer 与 scroll 的显式公开入口；
- 将 Office/CJK/Latin 字体候选栈与 CSS 格式化收敛为 `/font-stack` 纯叶子入口；主 Renderer、Slides 与 hidden worker 复用同一实现，删除无独立生命周期的 `renderer-platform` 薄包；
- Host 与官方 renderer 插件共享单一 runtime，插件 artifact 只保留 Host external，不复制 Vue、组件或全局 CSS；
- 插件通过 `peerDependencies` 与 `plugin.json.compat.rendererUi` 声明同一 SemVer range；
- 商店检查、远程安装和运行时加载均在副作用前执行兼容性接纳；
- Date/Time 外层面板支持 Escape 关闭；TimePicker 对非五分钟整点的既有值保留真实分钟选项，不舍入数据；
- 删除旧 Host shared 组件、样式、scroll 真源和 `@plugin/renderer/toolUi` / `@plugin/renderer/scroll` runtime facade；
- 不兼容迁移前内部 import、旧 manifest 或旧插件 artifact，UI、UX、文案与视觉结果保持迁移前行为。
