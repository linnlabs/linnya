# Changelog

本文件记录 `@linnya/renderer-ui` 的公开 JS、CSS、token、主题、overlay 与 scroll 合同变化。

## 3.18.0 - 2026-11-27

- `LinnyaLoadingIcon` 删除“光流”动态：`activity="processing"` 弃用，显示与 `thinking` 相同的摇曳（根节点 `data-state` 为 `thinking`），下一个 major 删除这个取值；默认 `activity` 从 `processing` 改为 `thinking`，不传时显示摇曳。转写、翻译、审阅等处理已有材料的位置随之改为摇曳。光流专用的 30% 浅色底、亮带遮罩与 `linnya-ui-icon-flow` 关键帧一并删除；减少动态效果时直接停住部件，仍是完整实色标识。摇曳、生长的每一帧不变。
- 现有 `^3.0.0` 插件保持兼容，仍传 `processing` 的插件不用改动，显示为摇曳。

## 3.17.0 - 2026-11-27

- 新增只读查询 `isModalOverlayOpen()`：浮层栈里有没有模态层（弹窗、确认框、图片预览、用 `useModalOverlay` 的自有模态浮层）；下拉、日期面板等临时浮层不算。Host 的全局快捷键据此不作用于被盖住的页面，接住还是放行由 Host 决定。
- `BaseDropdown` 打开时进入浮层栈，不再自己监听 document 的 Escape：开在弹窗里时第一次 Escape 只关下拉，此前会连同弹窗一起关闭。关闭时照旧停止冒泡、把焦点还给触发器；props、事件与插槽不变。
- 现有 `^3.0.0` 插件保持兼容。

## 3.16.0 - 2026-11-27

- Escape、遮罩点击与键盘焦点改由同一份浮层栈按打开顺序归属，此前 Escape 与焦点各有一份登记、各装一组 document 监听。新增 `useModalOverlay({ active, containerRef, onEscape, onBackdropClick })`，返回 `isTopmost()` 与绑定到遮罩元素的 `backdropListeners`；新增类型 `ModalOverlayOptions`、`ModalOverlayControls`、`ModalBackdropListeners`。
- 遮罩点击只给最上面一层：`Modal`、`ImagePreviewModal` 里开着 `CustomSelect` 或日期、时间面板时，第一次点遮罩只关面板，不再连同弹窗一起关闭；在弹窗里按下、拖到遮罩上松开不再关闭弹窗。只派发 `click`、没有先在遮罩上按下指针的程序化点击不再关闭弹窗。
- `AlertDialog` 挂载时就可见也响应 Enter，此前要等 `visible` 变化一次才开始监听；上面还开着下拉或面板时不响应 Enter。
- `useModalFocus` 弃用：它只管焦点、不处理 Escape 与遮罩，改用 `useModalOverlay`，下一个 major 删除。导出与行为保留，现有 `^3.0.0` 插件保持兼容。

## 3.15.0 - 2026-11-27

- 新增 `useAnchoredPosition({ anchor, floating, open, placement })`：菜单、下拉、Popover、面板等贴着锚点弹出的浮层的统一定位入口，返回绑定到浮层根元素的 `style`、实际落在哪一侧的 `side`、`isPositioned` 与 `update()`。`placement` 可选 `side`（默认 `bottom`）、`align`（默认 `start`）、`gap`（默认 8）、`alignOffset`、`viewportMargin`（默认 8）、`flip`（默认翻转）、`matchAnchorWidth`、`fitViewportHeight`。打开期间跟随祖先滚动、窗口缩放与锚点 / 浮层尺寸变化；关闭后停在最后位置，让退场动画原地结束。同时新增 `computeAnchoredPosition`（一次性计算）、`createPointAnchor(x, y)`（右键菜单等以点击位置为锚）、`anchoredMotionDirection(side)` 与类型 `AnchoredSide`、`AnchoredAlign`、`AnchoredAnchor`、`AnchoredPositionOptions`、`AnchoredPosition`、`AnchoredFloatingStyle`、`UseAnchoredPositionOptions`、`AnchoredPositionControls`。
- 新增运行依赖 `@floating-ui/dom`（MIT，浏览器安全，此前已随编辑器依赖装在工作区）。计算交给它：量浮层用布局尺寸，入场缩放不影响打开当帧的位置；放不下时翻到对侧，上下都放不下时整体推回视口。
- Portal 下拉面板、`SimpleDatePicker` / `TimePicker` 面板与 `TextPopover` 改用它。Portal 下拉与 `TextPopover` 打开期间随滚动、窗口缩放跟着触发器走，此前只在打开时算一次，滚动后会与触发器脱开；props、事件与间距不变。
- `measureFloatingLayoutSize` 标为弃用：包内与 Host、官方插件已不再使用，新浮层改用 `useAnchoredPosition`。导出保留，现有插件不受影响。
- 现有 `^3.0.0` 插件保持兼容；Slides 与 Canvas 改用新入口，兼容范围升到 `^3.15.0`。

## 3.14.1 - 2026-11-26

- `NotificationBar` 的长提示改为折行，不再单行截断：此前宽 300px 只显示一行，英文界面大约三分之一的提示后半句被省略号截掉（如“删掉后才能保存”这类关键说明）。现在最宽 360px，图标对齐首行，续行与首行文字左对齐，`text-wrap: pretty` 避免末行只剩一两个字；超长内容（如后台原文）最多 4 行后省略。单行提示的尺寸与位置不变。
- props、DOM、class 与类型不变，现有 `^3.0.0` 插件保持兼容。

## 3.14.0 - 2026-11-25

- `Modal`、`AlertDialog`、`ImagePreviewModal` 统一管键盘焦点：打开时焦点进入弹窗，Tab / Shift+Tab 在弹窗里循环，焦点被带到后面的页面时拉回来，关闭后回到打开前的位置（业务已经把焦点放到别处时不抢）。弹窗里打开的下拉、日期面板自己管焦点，不受影响；背景仍不设 inert。此前焦点留在后面的页面，Tab 会走到被盖住的按钮上。
- 弹窗补上 `role="dialog"`（确认框为 `alertdialog`）、`aria-modal` 和指向标题的 `aria-labelledby`。
- 新增 `useModalFocus({ active, containerRef })` 与类型 `ModalFocusOptions`、`ModalFocusControls`：保留自有 DOM 的模态浮层用它参与同一顺序。Host 的设置窗已改用。
- `AlertDialog` 新增 `defaultAction`（`'confirm'` 默认、`'cancel'`）：后果严重、可能被误触的确认可以让 Enter 默认取消。焦点在弹窗里的某个按钮上时，Enter 按的是那个按钮；确认框叠确认框时只有最上面的响应 Enter，此前两层会同时确认。
- 现有 `^3.0.0` 插件保持兼容；在弹窗打开期间自己往后面的页面放焦点的调用方会被拉回弹窗。

## 3.13.0 - 2026-11-25

- 新增 `MonthCalendar` 与 `MonthCalendarProps`：平铺在界面里的月历，可以选日，也可以 `selectable: false` 只用来看；`minDate` 之前的日子不可选，`isMarked` 标出指定日期，`v-model:month` 是当前展示的月份。整个月历只占一个 Tab 位，方向键、Home/End、PageUp/PageDown 移动。`SimpleDatePicker` 的面板改用它。
- `SimpleDatePicker` 的面板改为挂到 body 并按视口定位：此前触发器靠左或在滚动容器里时，面板会被裁掉一截。Escape 改为参与浮层归属，在弹窗里只关面板；打开后焦点进入月历，关闭后回到触发器。props、事件和选日保留时间的规则不变。触发器里的图标不再被调用方的内边距压扁。英文月份标题改为月在前（新增文案键 `shared.simpleDatePicker.yearMonth`）。
- `TimePicker` 改为可以直接输入的时间框（9、930、9:30 都认，回车或离开时生效，认不出就退回原值），点开是半小时一格的列表，选中即生效；不再有时、分两个下拉和“取消 / 确定”。props、事件与“替换时分并清零秒、毫秒”的规则不变，新增可选的 `ariaLabel`。移除不再使用的文案键 `shared.timePicker.cancel`、`shared.timePicker.confirm`。
- `CustomSelect` 自动模式的菜单参与 Escape 归属：此前在弹窗里用鼠标点开菜单再按 Escape，会直接关掉整个弹窗；现在先关菜单、焦点回到触发器，再按一次才关弹窗。子菜单里的 Escape 仍只收起这一级。`manualMode` 不变。
- 现有 `^3.0.0` 插件保持兼容；官方插件目前没有使用日期、时间选择器。

## 3.12.2 - 2026-11-21

- `Switch` 始终显示调用方确认的值。插件有检索任务正在运行而拒绝停用时，开关保持启用；请求被接受后仍按 `modelValue` 正常更新。公开接口和插件兼容范围不变。

## 3.12.1 - 2026-11-19

- 图标根节点 `.linnya-ui-icon` 没有显式尺寸时默认 `1em`（零优先级规则，`shared-icon--em / --full / --fit`、业务选择器和图标自带的 `width` / `height` 属性照常覆盖），此前漏写尺寸的图标会按 SVG 默认的 300×150 撑开。已逐页比对现有界面：设置全部页签、项目概览、编辑器与 Slides、插件商店、知识库、对话页的图标尺寸和截图都没有变化，只防止以后新增的未写尺寸图标撑大布局。现有 `^3.0.0` 插件保持兼容。

## 3.12.0 - 2026-11-19

- 多层浮层同时打开时，Escape 只交给最后打开的那一层：`Modal`、`AlertDialog`、`ImagePreviewModal` 改为登记到 document 级的 Escape 归属（整个 document 只有一个监听）。此前设置里打开的模型详情按 Escape 会连同外层设置一起关闭；现在先关详情，再按一次才关设置。最上层的 `Modal` 设了 `closeOnEsc: false`（例如处理中）时，Escape 不再穿透关闭下面一层。
- 新增 `useEscapeLayer({ active, onEscape })` 与类型 `EscapeLayerOptions`：保留自有 DOM 的业务浮层用它参与同一顺序，不再自己监听 document 的 Escape。Host 的设置窗已改用。
- `AlertDialog` 去掉自己的 Escape 监听，只由内层 Modal 处理：此前一次 Escape 会发出两次 `close` / `cancel`，现在只发一次；Enter 确认保持不变。仅依赖“Escape 触发一次关闭”的调用方不受影响；曾依赖两次事件的调用方（不应存在）需要改为幂等处理。现有 `^3.0.0` 插件保持兼容。

## 3.11.0 - 2026-11-18

- 新增 `ShieldKeyholeIcon`、`ShieldCheckmarkIcon`、`ShieldErrorIcon`：同一个盾牌外形，里面分别是锁孔、对勾、感叹号（Fluent shield_keyhole / shield_task / shield_error 几何，1u 描边）。对话输入框用它们表示命令权限的只读、标准与完全访问。
- `CustomSelect` 新增 `selected-value` 插槽（作用域参数 `displayValue`），可把触发器里的选中文字换成图标等内容；新增 `triggerTooltip`：设置后触发器用共享提示服务的悬停提示，不再输出原生 `title`，没有 `triggerAriaLabel` 时它也是可访问名称。不设置时行为不变。

## 3.10.0 - 2026-11-17

- 新增 `CommandBar`：停靠在画布或文档顶部的命令条表面（`role="toolbar"`，4px 内边距、10px 圆角、默认底色），内部用 `ToolbarGroup` / `ToolbarButton`。只拥有外观，位置、显隐与命令由调用方负责；class、style、aria 与事件落在根元素。Slides、Canvas 的顶部命令条与 Markdown 的悬浮格式条都改用它，不再各写一份表面样式。
- 新增 `--shadow-command-bar`：命令条与同族小浮起控件（Canvas 缩放、审阅条）的阴影，取值与原先各处手写的三层阴影相同。

## 3.9.0 - 2026-11-17

- 配色换成薄荷绿：`--color-brand-*` 整条色阶改为 H158 的薄荷（500 `#6bb88d`，强调实底 600 `#3d825d` 白字 4.62:1，选中浅底文字 700 `#337251` 在 125 上 5.09:1），`--color-accent-rgb` 同步；`--color-gray-*` 明度不变，加一点跟随品牌色相的色偏。token 名不变，引用语义 token 的组件与插件无需修改。
- 新增状态色阶 `--color-signal-{success,error,warning,info}-{50,200,400,500,600,900}`：四色同一明度带、彩度接近旧值，成功绿与品牌色分开。`--color-success*`、`--color-error*`、`--color-warning*`、`--color-info*` 改为引用它们；浅色下文字在各自浅底上 4.86–5.54:1。
- `moon-blue` 改为很淡的月白蓝：新增 `--color-moon-*`（底色与边框）、`--color-moon-accent-*`（强调蓝，实底 `#4079ac` 白字 4.62:1）与 `--color-moon-shadow`；底色彩度降到 C0.003–0.009，文字改为带一点蓝的墨色，链接用强调文字色。
- 少边框：新增 `--color-bg-field` / `--color-bg-field-hover`（主文字色 5% / 8% 叠加）。`CustomTextField`、`CustomSelect`（bordered）、`SecretInput`、`CustomNumberInput`、`TimePicker` 与 `BaseButton` 的 `secondary` 静止时不画边框，用浅底表达边界，聚焦时才出现强调色描边；输入框的底色在悬停、聚焦时不变，选择器、时间选择与 `secondary` 悬停加深；`ghost` 改为透明底无描边。
- 弹窗与可拖拽面板四边同距：新增 `--modal-inset`（24px）与 `--floating-panel-inset`（20px）。`Modal` 默认滚动模式下由 Modal 负责正文与 footer 的左右、底部边距，标题行与关闭钮按笔画对齐到同一边距；调用方原来给正文或 footer 写的左右内边距需要删掉，否则会叠加。`internal` 模式的调用方用 `var(--modal-inset)` 写左右边距。`AlertDialog` 与 `DraggablePanel` 已按新边距调整；`height="auto"` 的 `DraggablePanel` 不再受 180px 最小高度约束。
- `LinnyaIcon` 的默认颜色由 `--color-brand-500` 改为 `--color-accent`（浅色主题是加深的品牌色 `#3d825d`），与主按钮、选中态同一个绿；调用方不必再各自写颜色，需要别的颜色时仍在图标自身的 class 上覆盖。
- `IconButton` 新增 `size="composer"`（26px 外框、18px 图标），只用于对话输入框底栏，与模型选择器同高；别处继续用 xs / sm / md / lg。
- `SidebarIcon` 的方框由 14 放到 15（墨迹 16，圆角 2.75），与同排的 `LibraryIcon`、`SettingsIcon` 一样大；组件名与 `data-icon` 不变。
- 新增 `measureFloatingLayoutSize(element)`：返回弹层的布局宽高（`offsetWidth` / `offsetHeight`）。弹层入场从 0.96 缩放，打开当帧用 `getBoundingClientRect()` 量到的是缩小后的尺寸，按它把弹层放到按钮上方会贴住按钮，动画结束再重算就会跳一下；量弹层自身尺寸改用这个函数，锚点仍用 `getBoundingClientRect()`。`TextPopover`、`SimpleDatePicker` 与下拉面板定位已改用布局尺寸。

## 3.8.0 - 2026-11-17

- `DraggablePanel` 不再提供高度调整：去掉上下边缘与四个角的 resize 手柄，只保留左右边缘调整宽度；手柄悬停只换成 `ew-resize` 光标，不再画蓝色条。`resizeDraggablePanelGeometry` 与 `DraggablePanelResizeDirection` 的公开签名不变。
- `BaseButton`、`IconButton` 的文字不可被拖选（`user-select: none`），放进可选正文区域里也一样。

## 3.7.1 - 2026-11-17

- `CustomSelect` 触发器与 `SecretInput` 由 36px 收到 `--control-height-md`（32px），字号统一为 13px（`--font-size-body`），文字距边 10px，与单行输入、md 按钮同高同字号，表单同一行对齐；选择器箭头 16px → 14px，密文显隐按钮宽 40px → 36px。`minimal` 选择器不变。现有 `^3.0.0` 插件保持兼容。

## 3.7.0 - 2026-11-17

- 悬停底色改为主文字色的半透明叠加：`--color-bg-hover` 浅色 7%、深色 10%、月白蓝 7%，`--color-bg-hover-strong` 为 12% / 16% / 12%，`--color-bg-hover-light` 并入 `--color-bg-hover`。此前三档是固定实色，可见度取决于下面的底色：深色工具条上 hover-light 只比底色亮 1.075:1（几乎看不出），浮起表面上反而更暗；月白蓝下各档只有 1.01–1.06:1。现在各底色上一致：浅色 1.15:1（与原 hover 相同）、深色约 1.3:1、月白蓝约 1.14:1。token 名不变；把悬停色当作不透明底参与 `color-mix` 的调用方，混合结果会带透明度，需改为与所在底色混合主文字色。现有 `^3.0.0` 插件保持兼容。

## 3.6.2 - 2026-11-17

- `ToolbarButton` 为直接子级图标提供 16px 方形图标槽（`:where` 低优先级，调用方仍可覆盖）：此前按钮不定尺寸，图标按自带 class 变成 12px、16px 或被拉成 16×20 并上移 2px。
- 深色主题下的阴影不再发光：`DraggablePanel`（含 mini）与 `CustomSlider` 拇指悬停的扩散阴影由主文字色改为黑色；主文字色在深色主题里接近白色，原写法让阴影变成一圈亮光。贴边 0 偏移的细环保持主文字色。浅色主题观感不变。现有 `^3.0.0` 插件保持兼容。

## 3.6.1 - 2026-11-17

- 按视觉平衡调整三枚图标的路径，组件名、属性与 `data-icon` 不变：`SidebarIcon` 方框中心线由 13 放到 14（圆角 2.5），与同排的知识库、设置图标一样大；`BulletListIcon` 圆点半径由 1 放到 1.5，行位不变，与 `NumberedListIcon` 等重；`UnderlineIcon` 的 U 由 9×13 放到 10×14，与 `HeadingIcon` 同高。现有 `^3.0.0` 插件保持兼容。

## 3.6.0 - 2026-11-17

- 弃用 `BaseButton` 的 `soft` variant：删除它的样式（渐变浅底、描边与悬停投影），传入 `soft` 时按 `tint` 渲染，下一个 major 删除该类型成员。`ActionButtons` 的 `primaryVariant="accent"` 改为对应 `tint`。`tint` 的用途扩展为与 `primary` 并列、推荐但不抢主操作的动作。props 与类型保持兼容，现有 `^3.0.0` 插件无需修改；新代码改用 `tint`。

## 3.5.1 - 2026-11-17

- `ColorPickerPanel` 的宽度改为跟随色块（`width: fit-content`），色块网格为五列定宽 32px，行距与列距同为 8px：此前每列按 `1fr` 分配，放进比色块宽的容器（如 Slides 属性面板）时色块靠在各列左侧、列距被拉大，最后一列右侧空出一截，与右对齐的“清除颜色”按钮对不齐。现在面板不再被容器撑宽，按钮与最后一列对齐。公开 props、事件与 DOM 不变，现有 `^3.0.0` 插件保持兼容。

## 3.5.0 - 2026-11-16

- 新增界面调度函数，替代直接调用 `setTimeout`、`setInterval`、`requestAnimationFrame`：`Timer`（延迟、防抖、节流、自动关闭，`start` 重新计时、`startIfIdle` 保持原计时）、`RepeatingTimer`（轮询、时钟）、`FrameBatch`（同一帧内多次请求只执行一次，用于滚动、拖拽、尺寸变化）、`FrameLoop`（每帧执行直到停止，callback 返回 `false` 自动停止），以及 `onNextFrame` / `onNextPaint`（返回取消函数）与 `nextFrame` / `nextPaint`（Promise）。组件 setup 里用 `useTimer` / `useRepeatingTimer` / `useFrameBatch` / `useFrameLoop`，卸载时自动取消；组件外用对应的 `create…` 版本，由调用方收尾。没有 `requestAnimationFrame` 的环境用定时器代替。新增导出，现有 `^3.0.0` 插件保持兼容；使用新函数的插件需声明 `^3.5.0`。

## 3.4.1 - 2026-11-09

- `CustomSelect` 的菜单项不再显示全局焦点环：键盘操作时当前项用与悬停相同的底色表达；用鼠标打开菜单时首项拿到焦点但不显示任何效果（此前先按过键再右键，首项会出现焦点环）。公开 props、事件与键盘导航不变。 现有 `^3.0.0` 插件保持兼容。

## 3.4.0 - 2026-11-08

- 新增 `InlineTextInput`（就地编辑框）与 `InlineTextInputVariant` 类型：重命名、连线标签等在原位置改一段短文本时使用。编辑中统一为 28px 高、主题色细描边、不透明底色；`variant="inline"` 嵌在列表行里、从被替换文字的起点开始，`variant="floating"` 浮在内容上、随文字伸缩并带浮层阴影。回车与失焦提交、Esc 取消，一次编辑只结束一次；输入法组字中的回车不会提交；键盘事件不冒泡到宿主快捷键。Host 的文件树与对话列表重命名、画布连线标签已改用它。新增导出，现有 `^3.0.0` 插件保持兼容；使用新组件的插件需声明 `^3.4.0`。

## 3.3.0 - 2026-11-09

- 新增 `GlanceIcon`（Fluent glance 几何，四块错落的卡片）作为项目概览入口图标，新增 `OptionsIcon`（Fluent options 几何，两条滑轨各带一个圆钮）用于打开显示设置。

## 3.2.0 - 2026-11-03

- `CustomSelect` 新增可选 `showSelectedCheckmark`（默认 `false`）：开启后每个可直接选中的选项右侧保留一个 16px 定宽槽位，选中项在槽位里显示 `CheckmarkIcon`，未选中项留空，所以切换选择时标签宽度不变。选中不再只靠强调色表达；对勾颜色与选中底色沿用既有选中样式，槽位和图标 `aria-hidden`，选中语义仍由 `aria-selected` / `aria-current` 承担。带子菜单的父项右侧已有箭头、行内数字项右侧是输入控件，都不占槽位；开关同时作用于主菜单、一级与二级子菜单里的叶子项。默认关闭时 DOM 与外观不变，现有 `^3.0.0` 插件保持兼容。

## 3.1.1 - 2026-11-03

- `CustomSelect` 的默认触发器不再让选中文字压到下拉箭头：右侧为文字预留的空间由箭头的位置、尺寸和一段 8px 间隙推出（此前少 4px，文字与箭头笔画几乎相接）。箭头位置与尺寸不变，宽度按内容收缩的选择器变宽 12px，固定宽度的选择器可用文字宽度相应少 12px；公开 props、事件、slot 与 DOM 结构不变，`variant="minimal"` 与业务自己覆盖了触发器内边距的选择器不受影响。现有 `^3.0.0` 插件保持兼容。

## 3.1.0 - 2026-11-01

- 新增 `UpdateIcon`（Fluent arrow_circle_up 几何）作为应用更新入口图标。可选属性 `progress`（0–1）把圆环变成 30% 底环加从 12 点钟顺时针的进度弧；不传时是静态图标。

## 3.0.1 - 2026-10-30

- 适配 Vue 3.5.44 的属性引用类型推导：`CustomSelect` 用 getter 提供只读 prop 引用，保留选项更新、键盘导航和外置触发器的响应性；公开 props、事件、样式和交互语义不变，现有 `^3.0.0` 插件保持兼容。

## 3.0.0 - 2026-10-30

- `/icons` 全部图标改为同一套 24 画布、1u 描边的母版生成：几何以 Fluent System Icons 20 Regular（MIT）为基准，按统一的关键形、圆角、像素对齐与修饰角标规则重绘；带角标的图标改为实心角标并在角标外 1u 截断主体。所有图标根节点新增 `linnya-ui-icon` class 与 `data-icon`，原有根 class 保留。
- 图标改按图形起名，方向、对齐、状态改用属性表达；逐像素相同的图标合并。删除与改名都是不兼容变化，插件需按下表迁移并把 `compat.rendererUi` 升到 `^3.0.0`。
- 新增 `UndoIcon`、`RedoIcon`、`PasteIcon`、`DuplicateIcon`、`TextIcon`、`RectangleIcon`、`EllipseIcon`、`AlignObjectsIcon`、`DistributeIcon`、`ArrangeIcon`、`BringToFrontIcon`、`SendToBackIcon`、`FontSizeIcon`、`TextBoxAlignIcon`、`PlayPauseIcon`、`LinnyaLoadingIcon`、`RunControlIcon`、`DocumentTextIcon`、`NumberedListIcon`。
- `DocumentTextIcon`（折角文档加三行文字）用作 Linnya 内置文档类型的图标；空白的 `DocumentIcon` 留给未注册类型的文件，Linnya 自己的文档不再和“不认识的文件”长得一样。
- `LinnyaIcon` 由同一图标库生成，`variant` 与 1em 尺寸不变；它同时作为 AI 入口图标，取代原来的 `AiIcon`。品牌色实底按钮里由调用方把颜色改为按钮文字色。
- `LinnyaLoadingIcon` 取代涟漪加载：`activity` 为 `processing`（默认，光流）、`thinking`（摇曳）或 `generating`（生长），保留 `color` 属性，默认 18×18。
- `/styles.css` 新增图标动效样式：方向箭头旋转、复制对勾、显示 / 隐藏、播放 / 暂停替换、发送 / 暂停 / 继续（暂停与继续之间两条竖线形变成三角）、刷新与加载旋转、Linnya 进行中三种动态；只引用 motion token，减少动态效果时停在静态图形。
- `RunControlIcon` 是对话输入框主按钮的图标，`action` 为 `send`、`pause` 或 `resume`，不带外圈，用在深色实底按钮里。
- `CustomSelect` 的子菜单箭头、`SimpleDatePicker` 的翻页按钮、`TextPopover` 的关闭按钮由文字字符改为 `ChevronIcon` / `CloseIcon`，不再随字体变形；`SimpleDatePicker` 翻页按钮补上可访问名称（新增本地化键 `shared.simpleDatePicker.previous` / `next`）。`.option-arrow` 现在是 12px 的 SVG，主菜单与各级子菜单同尺寸。
- 2.6.0 记录的 `--spacing-*` / `--transition-*` 兼容别名本版仍保留，删除顺延到之后的 major。

改名：

| 旧组件 | 新组件 |
| --- | --- |
| `AddCommentIcon` | `CommentAddIcon` |
| `AlignIcon` | `TextAlignIcon` |
| `ChecklistIcon` | `ArchiveCheckmarkIcon` |
| `DocumentRightIcon` | `DocumentArrowIcon` |
| `EditFileIcon` | `DocumentEditIcon` |
| `EnterLeftIcon` | `EnterIcon` |
| `EvidenceIcon` | `BookIcon` |
| `ExportDocxIcon` | `DocumentDocxIcon` |
| `ExportPdfIcon` | `DocumentPdfIcon` |
| `ExportTxtIcon` | `DocumentTxtIcon` |
| `KnowledgeBaseIcon` | `LibraryIcon` |
| `ListItemIcon` | `BulletListIcon` |
| `MinusIcon` | `SubtractIcon` |
| `NewFileIcon` | `DocumentAddIcon` |
| `NewFolderIcon` | `FolderAddIcon` |
| `OkIcon` | `CheckmarkIcon` |
| `OpenIcon` | `FolderOpenIcon` |
| `ResearchIcon` | `MicroscopeIcon` |
| `ReviewIcon` | `DocumentPersonIcon` |
| `SecretVisibilityIcon` | `EyeIcon` |
| `SolvedCommentIcon` | `CommentCheckmarkIcon` |
| `SourceIcon` | `ExternalLinkIcon` |
| `TimeIcon` | `ClockIcon` |
| `UnsupportedDocumentIcon` | `DocumentErrorIcon` |

删除：

| 删除的组件 | 改用 |
| --- | --- |
| `AiIcon` | `<LinnyaIcon />（AI 入口；品牌色底上由调用方改白）` |
| `AlignBottomIcon` | `<TextBoxAlignIcon alignment="bottom" />` |
| `AlignMiddleIcon` | `<TextBoxAlignIcon alignment="middle" />` |
| `AudioIcon` | `<SpeechToTextIcon />` |
| `BackgroundColorIcon` | （无替代；`ToolbarColorButton` 自带背景色入口） |
| `ChevronRightIcon` | `<ChevronIcon direction="right" />` |
| `FontSizeDecreaseIcon` | `<FontSizeIcon direction="decrease" />` |
| `FontSizeIncreaseIcon` | `<FontSizeIcon direction="increase" />` |
| `ListIcon` | `<BulletListIcon />（原三条线与左对齐几乎相同，改用带圆点的列表）` |
| `OutlineIcon` | `<BulletListIcon />` |
| `PauseIcon` | `<PlayPauseIcon :playing="true" />` |
| `PlayIcon` | `<PlayPauseIcon :playing="false" />` |
| `PlusCircleIcon` | `<AddCircleIcon />` |
| `RippleLoadingIcon` | `<LinnyaLoadingIcon />（旧的 color 属性保留；对话等待处改 activity="thinking"）` |
| `TextColorIcon` | （无替代；`ToolbarColorButton` 自带文字颜色入口） |
| `WindowMaxRestoreIcon` | `<WindowActionIcon action="maximize" :is-maximized="…" />` |

## 2.8.0 - 2026-10-28

- 小浮层改为从触发边缩放出来：新增 `--popup-enter-down` / `--popup-enter-up`（`scale(0.96)` 加 4px 位移）、`--popup-leave`（`scale(0.98)`）与 `--popup-transition-enter`（`--duration-short` + `--ease-enter`）/ `--popup-transition-leave`（`--duration-micro` + `--ease-standard`）；`DropdownPanel`、`TextPopover`、`SimpleDatePicker`、`TimePicker`、`DraggablePanel` 及业务里 20 余处写死 `translateY(-8px)` 的菜单、下拉与引用卡片迁到这组 token，并按落点写 `transform-origin`。进入 150ms、离开 100ms；类名与 DOM 结构不变。
- 悬停提示统一由一个共享服务绘制：`IconButton` 不再使用原生 `title`，`label` 通过 `data-linnya-tooltip` 交给服务；`HoverTooltip` 保留 props 与对外行为入口，但不再用 `Teleport` 渲染每个气泡，改为同一个全局气泡。首次悬停等待 500ms、相邻控件之间与刚消失 300ms 内无延迟、键盘 `focus-visible` 立即出现；点击或 Esc 收起，放不下时自动翻到另一侧。`HoverTooltipWindowFocusPort` 与输入来源状态机不变。`IconButton` 的 `:tooltip="false"` 与自带 `title` 的用法保持可用。
- `ImagePreviewModal` 新增可选 `sourceElement`，并新增 `useImagePreviewSource()`（在点击处记录缩略图）：传入后用 View Transitions 让大图从缩略图展开、关闭时缩回；没有缩略图、缩略图已离开屏幕、浏览器不支持或减少动态效果时退回淡入。关闭过程中大图保持到过渡结束（不再随调用方清空 `src` 而提前消失）；去掉大图上不必要的 `loading="lazy"`。runtime catalog 同步新导出。
- `Modal`（及 `AlertDialog`）的进出场改为遮罩与本体分开动：遮罩只淡底色，弹窗本体从 `scale(0.97)` 加下移 8px 缓出到位（进入 `--duration-medium` + `--ease-enter`，离开 `--duration-micro` + `--ease-standard`）。新增 token `--modal-hidden`、`--modal-transition-enter`、`--modal-transition-leave`；原先隐式使用浏览器默认 `ease` 的整体 `opacity` 过渡去掉。DOM、类名、事件与滚动模式不变。
- `SegmentedTabs` 的下划线改为单根指示器在页签之间滑动（`--duration-medium` + `--ease-standard`），首次位置直接落定；页签自身不再画下划线。
- `BaseButton` 的 `primary` 与 `tint` 新增按压反馈：按下缩到 `--motion-press-scale`（0.975），松手缓出回位；其它 variant 不变。
- 游离的缓动收口到 token：侧栏历史脉冲、大纲侧栏高度补间、输入框“配置模型”入场、时间线进出改用 `--ease-*` 与 `--duration-*`；删除一处注释掉的 `ease-in-out`。
- `IconButton` 新增 `tooltipText`（提示文字，默认同 `label`，用于附加快捷键）；任何元素可通过 `data-linnya-tooltip`（及 `-placement`、`-offset`）获得同一套提示；新增导出 `useHoverTooltipService`，Host 在应用根组件调用即可，`IconButton`、`HoverTooltip`、`ToolbarButton`、`SecretInput`、`SimpleDatePicker`、`ScrollToBottomButton` 挂载时也会各自持有它。`ToolbarButton`、`SecretInput`、`SimpleDatePicker`、`ScrollToBottomButton` 的原生 `title` 改为共享提示，`aria-label` 不变。
- 删除只在重复“减少动态效果下 `transition: none`”的三处样式（`DropdownPanel`、`CustomSlider` 滑块、`ToolbarButton`）：时长 token 已使这些过渡立即完成，单独关闭过渡反而让结束事件不再触发。
- 动效刻度存量清零：剩下的 3 处有意延迟（跑马灯起始、入场错峰、光束相位）改为带原因的 `scale-exempt`。
- 设计规范新增 7.4“浮层、提示与细节反馈”与细节清单两条，并补充 JS 动画取 token、减少动态效果与错峰延迟的规则、当前限制。

## 2.7.0 - 2026-10-27

- `Modal` 新增可选的 `title-extra` 插槽，用于标题旁的来源或状态标签；标题字阶、间距、长标题换行与关闭入口仍由共享组件拥有。
- 现有消费者无需传入新插槽，已有兼容插件继续使用 Host 提供的同一 Modal；不改变事件、滚动模式或关闭语义。

## 2.6.0 - 2026-10-15

- 错误文字色 `--color-error-text` 在浅色与月蓝由 `red-450`（`#b91c1c`）调为新增的 `--color-red-415`（`#d42020`）：白底 5.2:1、`--color-error-bg` 上 4.8:1，仍满足 AA，不再偏暗偏褐；暗色不变。
- 新增 `--color-error-bg-subtle`（浅色与月蓝取 `--color-error-bg`，暗色为 8% 半透明）：透明控件悬停与行内错误底，替代各处的基础色半透明红底；`BaseButton` 的 plain danger、`IconButton` 的 danger 悬停改用它。
- `NotificationBar` 浅色与月蓝的四种类型改用 `--color-*-bg` 实色底（info 文字对比度由 4.25:1 提升到 5 以上），暗色保持基础色 18% 半透明轻底。
- `--color-accent-light` 明确为图形强调色：不再用于文字、状态与小圆点，文字改用 `--color-accent-text`，圆点与手柄改用 `--color-accent`；描边与选区外框改用 `--color-border-accent-light`。三个 token 名称与值不变。
- 设计规范新增“色彩角色”表、错误文字与半透明底规则；样式刻度棘轮新增 `COLOR-02-raw-color-literal`，拦截十六进制与 `rgb()` / `hsl()` 色彩字面量，会话的思考区与工具卡描边迁到语义 token，月蓝的工具卡描边随之改为 `--color-border-light`。
- 新增[设计规范](./docs/design.md)，作为表面与文字层级、功能色、字阶、间距、圆角、投影、动效、交互状态和图标的唯一视觉规则入口。
- 新增 `BaseButton` 及严格 props / slots 类型：primary、secondary、ghost、plain、danger、soft、outline 七种语义 variant，outline 的 accent / info / neutral tone，sm / md / lg 三档尺寸、胶囊形与占满宽度；统一焦点环、禁用与过渡。runtime catalog 与真实 tarball consumer 同步新导出。
- `BaseButton` 新增 `tint` variant：品牌色平涂浅底加深色文字（`--color-accent-bg` / `--color-accent-text`），用于占满宽度的主操作；设置表单里整条的“添加”、Review 的“开始”等恢复为浅底（迁移前即是浅底），`primary` 实底留给紧凑按钮。
- `BaseButton` 的 `tone` 同时作用于 outline 与 plain，并新增 `danger`：plain + danger 静止中性、悬停显示错误色，用于行内删除与清理；`TimePicker` 的确定 / 取消改用 `BaseButton`，高度由 26px 统一为 28px。
- `ActionButtons` 改由两个 `BaseButton` 渲染，props、事件与插槽不变；按钮高度从 29.5px 统一为 `--control-height-sm`（28px），内部 `.action-btn` 选择器移除。
- 新增 `--color-accent-text`：强调色浅底上的文字（浅色 brand-700、暗色 brand-300、moon-blue blue-700），对比度不低于 4.5:1。`IconButton` 与 `ToolbarButton` 的选中态改用它。
- `DraggablePanel` 标题与 `ColorPickerPanel` 的强调字重改用 `--font-weight-semibold`；业务样式中的 `bold`、600～700 与 450～500 的字重归并到 semibold / medium，9px、10px 字号统一为 caption（11px）。
- 对比度修正：`--color-text-heading-meta` 浅色 / moon-blue 由 gray-421（约 2.7:1）加深到 gray-500，影响设置导航分组标题；`CharacterCount` 与 `SegmentedTabs` 的数量不再靠降低 `opacity` 弱化。
- 新增控件高度 token `--control-height-sm/md/lg`（28/32/36）。
- 新增 `IconButton` 与 `resolveIconButtonElement`：纯图标按钮的 xs / sm / md / lg 四档（20/24/28/32px，图标 14/18/18/20px）、ghost / subtle 底色、danger tone 与强调色浅底的 `active` 态；`label` 必填，同时作为可访问名称与原生提示，可用 `tooltip=false` 让位给外层 `HoverTooltip`；暴露 `element` 供浮层定位。新增组件 token `--linnya-ui-icon-button-hover-bg` 与 `--linnya-ui-icon-button-hover-bg-raised`：后者供已处于 hover / 选中底色的行把按钮 hover 提高一层，三套主题里都与行底色保持约 6 的 L* 差（暗色不再沿用只亮 1.8 L* 的 hover-strong）。runtime catalog 与真实 tarball consumer 同步新导出。
- 新增加载占位 `Skeleton`、`SkeletonBlock`、`SkeletonRows` 及公开类型：在 `--delay-reveal`（新增，200ms）后淡入，避免快速加载闪烁；`Skeleton` 自带 `role="status"` 与读屏文案；`SkeletonRows` 提供 28 / 32px 单行与带图标双行三档。新增 `--duration-loop`（1600ms）与组件 token `--linnya-ui-skeleton-bg` / `--linnya-ui-skeleton-highlight`，微光在减少动态效果时停止。runtime catalog 与真实 tarball consumer 同步新导出。
- `ScrollToBottomButton` 的进出动画改用 `--duration-long` 与 `--ease-enter` / `--ease-exit`，减少动态效果时立即完成。
- `Modal` 与 `DraggablePanel` 的关闭按钮改由 `IconButton` 渲染（`.modal-close`、`.close-btn` 与 `classNames.closeButton` 保留）；Modal 关闭图标恢复为 18px；`DraggablePanel` 默认标题与 Modal 标题同一层级（副标题字阶、semibold、主文字色）。
- 设计规范补充颜色使用规则、对比度要求、行距规则、组件规范（按钮层级与组合、卡片、徽标）与当前限制。
- 包内状态文字改用功能色 `*-text`，在浅色与暗色下均满足 AA。
- 三套主题新增 `--color-accent-solid` / `--color-accent-solid-hover`，作为反色文字所在的强调实底；暗色取更深一档，`BaseButton` primary 白字对比度从 3.1:1 提升到 5.2:1，浅色与 moon-blue 不变。
- 三套主题新增 `--color-bg-inverse` / `--color-bg-inverse-hover` / `--color-text-inverse`：浅色为深底白字，暗色反转为浅底深字，修正暗色下禁用态比可用态更亮的问题。
- `TimePicker` 主操作改用 `--color-text-on-accent` 与 `--color-accent-solid(-hover)`；样式刻度棘轮新增 `COLOR-01-base-palette` 规则，业务 CSS 只剩有意保留的基础色阶引用。
- `--color-info-text` 调整为浅色 / moon-blue `blue-600`、暗色 `blue-350`，比基础 info 稍深（暗色稍亮）；outline info tone 文字改用它，浅色从 3.3:1 提升到 5.2:1，暗色从 4.1:1 提升到 6.7:1，悬停时同样满足 AA。
- 新增刻度 token：角色字阶 `--font-size-{caption,footnote,body,prose,subtitle,title,headline,display}` 与成对行高、三档 `--font-weight-*`、4px 网格 `--space-*`、`--radius-xl` / `--radius-2xl`、`--border-width-hairline`、`--duration-*` 与 `--ease-*`、焦点环 `--focus-ring-width` / `--focus-ring-offset`；三套主题新增 `--color-focus-ring` 与功能色文字 `--color-{success,error,warning,info}-text`。
- `--spacing-*` 与 `--transition-*` 改为指向新刻度的兼容别名，数值不变；已发布插件无需重建，仓内新代码改用新 token，下一个 major 删除旧名。
- `prefers-reduced-motion: reduce` 下 `--duration-*` 置为接近 0，经由时长 token（含旧 `--transition-*` 别名）的过渡对减少动态效果的用户立即完成。
- 暗色主题修正层级：文字五级按对比度递减（primary 不再使用纯白，muted 从 1.4:1 提升到 5:1 以上）；边框改为透明白叠加，在任意表面上可见；按下/选中改为提亮；`--color-bg-elevated` 高于 surface；浮层投影（lg / xl）加深，xs / sm / md 与浅色保持同一强度；`--color-accent-disabled` 改为暗化而非浅绿。浅色与 moon-blue 视觉不变。
- `Modal` 标题改为 `subtitle` 字阶、semibold 与主文字色，不再使用比占位文字还浅的元信息灰；关闭按钮静止时退后一级、悬停提亮，形状固定为圆角方块（不再在悬停时由圆形变方），并显式声明 `type="button"`。props、插槽与事件不变。
- 三套主题在根元素声明 `color-scheme`（light / moon-blue 为 light，dark 为 dark），原生滚动条、表单控件与下拉弹层随主题切换明暗。
- `Modal`、`DraggablePanel`、`ColorPickerPanel`、`CustomCheckbox`、`CustomRadio` 的过渡改为显式属性，不再使用 `transition: all`；样式刻度棘轮新增 `MOTION-01-transition-all`。
- 设计规范补充主题与系统外观（含“跟随系统”只解析为 light / dark）、`transition` 写法、弹窗与列表行规则。
- 修复 CustomSelect 长普通子菜单超出窗口且末项不可达：两级列表限制可用尺寸并原生滚动，父菜单滚动及窗口 resize 时更新锚点或关闭不可见子层。
- 子菜单键盘焦点在显示后交接；关闭、切换或卸载取消旧请求，hover 保留当前焦点。Teleport 子层点击保留内部菜单归属，避免原生 Enter/Space 打开二级后被外部点击处理关闭。公开 API、选择事件和面板／颜色内容布局不变，属于兼容实现修正，随下次 Host 装配生效。

- LinnyaIcon 更新为叶片与茎分离的品牌图形，新增可选的 compact/display 尺寸稿；默认 compact，颜色跟随 currentColor，并由包样式提供默认品牌色。
- Linnya 助手及项目对话的空态使用 display 尺寸稿，由各自页面样式展示无背景的图标。
- `IconButton` 新增 `overlay` variant：叠在图片、视频等内容上的纯图标按钮，白色图标、悬停半透明白底，选中沿用强调色；颜色不随主题变化，半透明深色底条由容器提供。
- 业务侧迁移到 `IconButton`：对话与编辑器里图片上的操作按钮（`ImageRenderer`、`ImageBlockView`，使用 `overlay`，复制成功改为对勾图标）、输入框“+”按钮、音频块的面板开关 / 新建菜单 / 折叠按钮，以及 `CustomTextInput` 的清除按钮；清除按钮图标由 16px 统一为 18px。
- 对话回答、用户消息与输入框改用 `prose`（14/22）：此前回答与用户消息停在 `body`（13/20），比输入框还小；回答里的 Markdown 垂直节奏改为随字号缩放的 `em`，标题字号显式规定。
- 刻度收口（2026-10-17）：`Switch` 轨道与 `CustomSelect` 滚动条滑块改用 `--radius-full`，`CustomCheckbox` 圆角取 `--radius-sm`；`PageSectionHeader` 标题字号由 20px 改为 `--font-size-title`（18px），间距由 18px 归到 `--space-4`（16px），说明行高改为 `--line-height-prose`；`AlertDialog` 分组间距 14px 归到 `--space-3`；`HoverTooltip`、`CustomSelect`、`TextPopover`、`Switch`、`AlertDialog` 的比例行高改为同字号角色的 `--line-height-*`（单行文字变化不超过 1px）；`NotificationBar` 带边框的内边距改为 `calc(token - 1px)`，外尺寸不变。设计规范新增第 15 节“细节清单”，补充带边框控件按外尺寸对齐、胶囊与细条圆角、最高层 z-index、延迟与循环动画的写法，以及刻度棘轮的有意例外（`scale-exempt` 标注）。

## 2.5.2 - 2026-09-17

- ToolbarGroup 分隔线自身的左右 margin 收紧为 2px，与 4px flex gap 合计单侧 6px，修正 Slides 工具条组间多余留白。
- Editor 文本／表格工具条统一复用 ToolbarGroup，删除本地 divider、重复分组组件和分隔线 CSS；公开组件合同与插件兼容范围不变。

## 2.5.1 - 2026-09-17

- ToolbarColorButton 去掉额外 36px 最小宽度，沿用 ToolbarButton 的紧凑图标按钮宽度；Editor 与 Slides 同步修正文字色／填充色两侧多余留白。
- 不改变组件合同或插件兼容范围；已有 Host external 消费者直接使用 Host 的修正样式。

## 2.5.0 - 2026-09-16

- 新增 ToolbarButton、ToolbarColorButton、DropdownPanel 及公开严格类型；Editor 与 Slides 统一按钮、A/笔形颜色标识及标准下拉表面。
- DropdownPanel 与 CustomSelect 共用 150ms 上/下展开动效，支持 reduced-motion；退出表面 inert，快速重开恢复交互。
- BaseDropdown 新增公开 closeAndFocus 动作，普通关闭与外部点击继续不抢焦点，受控 BaseDropdown 挂载后立即接受外部点击；Editor 色板移除吞掉 Escape 的局部处理器。
- 删除两边重复的图标/按钮/面板样式和 Editor 虚构的 panel 选项；Slides peer/compat 升为 ^2.5.0，runtime catalog 与 tarball consumer 同步新入口。

## 2.4.0 - 2026-09-16

- 新增 `FloatingToolbar`、`ToolbarGroup` 及严格 props/position 合同，共享浮动表面、分组和样式；表单输入保持原生聚焦。
- Editor 文本选区及修订条迁移到共享外壳，选择、命令、内容颜色与鼠标选区保留策略仍归 Editor；其他浮条不再因共享 CSS 类名被误认成 Editor 表面。
- Host runtime catalog 和真实 tarball consumer 同步新导出；新增控件不改变旧组件合同。

## 2.3.0 - 2026-09-15

- 新增受控数值组件 `CustomSlider` 及公开 props/variant 类型，统一进度、原生键盘输入、禁用态与 default/compact 两档密度；
- Editor AI 设置和 Slides 缩放迁移后保留各自密度、范围与保存行为，删除重复样式和手动 DOM 进度同步；Slides 自定义颜色使用共享紧凑滑块；
- 新滑块统一提供 focus-visible 和 reduced-motion；原生字号/颜色业务合同不变；
- runtime catalog 与真实 tarball consumer 同步加入新导出；新 Slides artifact 要求 Renderer UI `^2.3.0`，旧兼容插件继续使用 Host 的同一 runtime，无需仅因此重建。

## 2.2.0 - 2026-09-05

- `TagChip`、`CustomCheckbox` 与 `CustomRadio` 新增明确节点的 `classNames` 合同，业务样式不再依赖组件私有 DOM selector；
- `CustomSelect` 新增 `optionsMotionDirection: 'down' | 'up'`，向上展开场景无需覆盖私有 transition class；
- `CustomSelect` 新增 `showOptionLabelTooltip`，允许长选项继续使用省略/滚动交互但关闭浏览器原生 tooltip；
- Renderer UI 源码与插件 artifact 门禁改为扫描 `src/**` 全部 CSS，feature-local 组件样式不再漏检。

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
