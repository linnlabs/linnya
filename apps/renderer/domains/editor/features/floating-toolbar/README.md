# Editor Floating Toolbar

本 feature 拥有编辑器选区浮动工具栏的完整业务闭包：Tiptap extension 识别选区并计算位置，registry 选择
provider，service 持有短生命周期展示状态，`ui/` 执行格式命令、引用动作和颜色/高亮交互，`styles/` 拥有
对应视觉规则。

它不是 Renderer 通用 toolbar。组件直接依赖 Editor command、本地化、内容色板和 Conversation composer
引用 port，因此不得进入 `@linnya/renderer-ui`，其他 domain 和插件也不得 deep import 本 feature 的内部文件。

## 目录职责

- `FloatingToolbarExtension.js`：监听 ProseMirror 选区与页面点击，编排显示、关闭和位置更新。
- `registry.ts`、`service.ts`：注册 provider，并维护当前工具栏组件和位置。
- `functions/`：标题、文字颜色和高亮选项的纯展示投影。
- `providers/`：把具体 Editor 选区映射为工具栏贡献。
- `ui/`：浮层容器、文本选区操作和颜色面板。
- `styles/`：只服务本 feature 的样式；迁移期间由 Renderer composition 按原 cascade 位置装载。

## 不变量

- 文本选区、全选和表格选区的显示条件及定位结果保持稳定。
- 点击工具栏内部不关闭；点击编辑器外部关闭；拖动选择期间不抢占选区。
- DOM、class、按钮顺序、文案、快捷交互、颜色值和 overlay 层级是现有 UX 合同。
- 基础按钮、选择器和平台图标继续从 `@linnya/renderer-ui` 消费；Editor 业务规则不得反向进入该包。
