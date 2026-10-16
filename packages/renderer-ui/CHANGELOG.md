# Changelog

本文件记录 `@linnya/renderer-ui` 的公开 JS、CSS、token、主题、overlay 与 scroll 合同变化。

## 2.6.0 - 2026-10-15

- 新增[设计规范](./docs/design.md)，作为表面与文字层级、功能色、字阶、间距、圆角、投影、动效、交互状态和图标的唯一视觉规则入口。
- 新增 `BaseButton` 及严格 props / slots 类型：primary、secondary、ghost、plain、danger、soft、outline 七种语义 variant，outline 的 accent / info / neutral tone，sm / md / lg 三档尺寸、胶囊形与占满宽度；统一焦点环、禁用与过渡。runtime catalog 与真实 tarball consumer 同步新导出。
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
