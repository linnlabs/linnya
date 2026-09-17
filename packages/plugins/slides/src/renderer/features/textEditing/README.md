# Slides 原位文字编辑

`textEditing` 拥有作者正文与原位 DOM 输入之间的适配。独立 Text 使用按需加载的 ProseMirror 编辑视图，Shape 内文继续使用原生 textarea。交接、草稿、IME 与异步回执仍由 [editingInteraction](../editingInteraction/README.md) 和 [manualEditing](../manualEditing/README.md) 唯一拥有；本模块不保存第二份文档，也不直接写 IPC。

## 源码合同

- 可编辑正文与 `Text.content` 一致：字符串或带 `style` 的文字 run 数组。保存的是完整作者值，不是 HTML、DOM Range 或编辑器 JSON。含公式的数组不投影改字能力，不能通过手工命令压平成字符串。
- `createTextEditingTarget` 消费 compiler 提供的原始正文和基准文字样式；不能从排版后拆分的 render runs 重建作者正文。既有加粗、斜体、下划线、字体、字距和行距保留，即使本期没有相应按钮。
- `richTextDocument` 的 schema 只有单段、文字、显式换行和作者样式 mark。选区格式事务只覆盖选中范围的指定字段；其他字段保持。普通 Enter 与 Shift+Enter 插入换行，粘贴接纳纯文本；不增加标题、列表、HTML 格式导入或公式编辑。
- 外层使用 inches/pt 到屏幕坐标的既有投影，局部字号使用 em 继承画布缩放和 autofit，不能把屏幕像素写回源码。输入期间的 DOM 流式换行仍不是正式 HarfBuzz finalization。

## 输入与工具条

- `InlineTextEditor` 按目标选择富文本或纯文本视图。独立 Text 的编辑代码与 ProseMirror 被拆为异步 chunk；普通预览及只读 CLI 不加载该编辑依赖。
- 非空文字选区输出 viewport 坐标及当前字号／颜色，混合值为 null。Stage 转为 pane 坐标，使用 elementProperties 的同一个工具条、下拉列表和颜色组件，只显示文字操作。光标状态不弹工具条。
- 编辑器和当前工具条组成一个焦点区域。点击字号、色板、子菜单不结束会话；编辑器失焦后仍用同一 PM selection 显示选中范围。点击外部先交接工具条数字的 change，再提交完整正文，最后让画布处理该次选择。焦点回执不能重开或覆盖输入会话。
- 选区格式事务进入本地撤销历史；Cmd/Ctrl+Z、Shift+Cmd/Ctrl+Z 可撤销／重做。Ctrl/Cmd+Enter 提交整个会话，Escape 丢弃未交接草稿。输入法期间不提交；compositionend 在 PM 的正式 DOM observer 接纳最终 mutation 后通知上层。
- Shape textarea 保留已验收的 Enter、IME、blur 和提交行为；本期不开放 Shape 分段样式。
- `TextDraftPreview` 按同样的作者 run 样式显示待保存／失败正文，不接受焦点或指针。正式帧安装后撤下；重入读取最新草稿。唯一蓝色外边框仍由 Canvas 选框拥有。
- Shape 缩放预览复用 shared/textLayout 的正式测量事实同步重排，与输入视图的临时 DOM 排版职责独立。

## 层次

- `definitions/`：输入目标、文字选区的窄合同。
- `functions/`：作者正文与编辑树转换、选区样式读写、CSS 投影。
- `orchestration/`：ProseMirror view、事务、历史、DOM observer 接入。
- `ui/`：原位视图、焦点区域接线、无焦点预览；CSS 仍通过正式 renderer stylesheet 清单加载。

## 验证

`richTextDocument.test.ts` 覆盖混合格式、局部修改、Unicode／换行、源码值转换及撤销重做；输入交接／失败恢复由 editingInteraction 组合测试覆盖。`smoke:preview-transitions` 用真实 Electron 指针和键盘覆盖范围选择、字号／颜色、混合值、工具条焦点、pending 重入及修订后重入，并保留 Shape 和八向缩放回归。真实队列、源码编译、SQLite 重开及 PPTX run 样式见 `backend/__tests__/manual-edit-save-reopen.integration.test.ts`。
