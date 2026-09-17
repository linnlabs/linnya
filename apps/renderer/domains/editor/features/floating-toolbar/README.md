# Editor Floating Toolbar

本 feature 拥有编辑器选区浮动工具栏的完整业务闭包：Tiptap extension 识别选区并计算位置，registry 选择
provider，service 持有短生命周期展示状态，`ui/` 执行格式命令、引用动作和颜色/高亮交互，`styles/` 拥有
对应视觉规则。

整个 feature 不是 Renderer 通用 toolbar。选区、命令、本地化、内容色板和 Conversation composer 引用 port 仍在本域；其他 domain 和插件不得 deep import 本 feature。

纯展示外壳 `FloatingToolbar` 与分组 `ToolbarGroup` 已由 `@linnya/renderer-ui` 统一拥有，文本选区容器和修订条从公开入口消费。Editor 在消费端保留 `mousedown.prevent`，避免破坏文本选区；共享外壳默认不吞原生表单事件。外部点击只识别 `data-editor-floating-toolbar`，不能用共享 CSS 类名把其他业务表面当作自己的。按钮、颜色标识与面板表面也消费共享组件；Editor 只拥有内容色板及业务布局，不覆盖共享组件内部 selector。

AI 引用区使用嵌套 ToolbarGroup 与后方格式控件分隔，不再手写 divider。分隔线统一由共享包提供，左右有效间距各 6px（4px gap＋2px margin），与 Slides、表格工具条一致；文字格式按钮自身既有的 2px 紧凑排列不变。

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

## 验证

`ui/FloatingToolbarContainer.test.ts` 使用真实 Tiptap Editor、extension、registry、容器和共享外壳，验证点击格式按钮保留选区并实际加粗；点击另一个业务的共享工具条关闭 Editor 浮条，不影响另一实例。jsdom 只替代没有布局能力的选区坐标读取。修订条接受／拒绝和选区追踪继续由 `Revision/ui/useDocumentRevisionToolbar.test.ts` 验证；共享包测试负责普通输入可聚焦和实例隔离。

文字／高亮入口使用共享 ToolbarColorButton（A／EditIcon＋色条），其他格式动作使用 ToolbarButton。颜色面板直接组合 BaseDropdown 与 DropdownPanel，不再创建虚构的 CustomSelect panel options，也不维护第二套按钮／图标／颜色面板过渡 CSS。具体色板、内容颜色解析和格式命令仍属于 Editor。旧色板局部处理器只吞 Escape 却不关闭面板，已删除；统一由 BaseDropdown 关闭并归还焦点。

`ui/TextSelectionToolbar.test.ts` 进一步挂载生产 TextSelectionToolbar 与真实文字色／高亮 Mark，验证范围保留、颜色／高亮提交、重开和色板 Escape 焦点交接。

选区订阅通过 on 注册、off 解除同一个回调；on 返回 Editor，不是取消函数。切换 Editor 实例后，旧文稿的 selectionUpdate 不能关闭新文稿色板；生产工具条集成测试覆盖这一场景。
