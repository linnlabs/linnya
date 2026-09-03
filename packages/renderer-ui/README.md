# Renderer UI

`@linnya/renderer-ui` 是 Linnya Host 与 renderer 插件共享的 browser-safe UI 包。它拥有基础组件、通用图标、组件本地化合同、主题与 token、scroll capability、字体栈展示纯规则，以及这些能力的唯一源码身份。

原 `apps/renderer/shared/components`、`shared/styles` 与 UI/scroll Host facade 已退出。基础能力由本包唯一
拥有；单一业务 UI 已归还 app/domain/feature。每个能力只有一个源码和 CSS owner，禁止兼容转发、双份样式、
deep import，或重新建立 Host 级通用组件杂物目录。完整消费示例见 [使用指南](./docs/usage-guide.md)。

## 公开入口

- 包根：ActionButtons、CharacterCount、CustomCheckbox、CustomRadio、Switch、TagChip、SegmentedTabs、PageSectionHeader、ScrollToBottomButton、CustomTextInput、SecretInput、CustomTextarea、CustomNumberInput、CustomSelect、BaseDropdown、TextPopover、Modal、AlertDialog、ImagePreviewModal、SimpleDatePicker、TimePicker、ColorPickerPanel、DraggablePanel、HoverTooltip、NotificationBar、`applyTextareaAutoResize`、颜色/面板/Tooltip 定位纯函数、Tooltip 窗口焦点 port、Renderer UI overlay layer 常量/纯函数，以及对应公开 props/value/variant/option/section/geometry/notification 类型。新增导出必须属于跨业务稳定 UI 能力，并同步 runtime entry catalog。
- `/font-stack`：Office/CJK/Latin 候选字体栈、CSS `font-family` 格式化与公开结果类型；这是无 Vue、DOM、CSS、Host 状态的纯叶子入口。
- `/icons`：无业务语义的平台图标。
- `/localization`：组件 message、fallback、resolver 与注入合同。
- `/scroll`：scroll viewport runtime、类型和 preset。
- `/theme`：内置主题 ID、selector 与纯函数。
- `/version`：运行时兼容性版本事实。
- `/tokens.css`：只包含公开/内部 token 与内置主题映射。
- `/styles.css`：Host 唯一加载的完整 package 样式。

`package.json` 显式列举全部入口。未列出的 `src/**`、组件文件和内部 CSS 都不是 API。

## 新增通用组件设计规范

本节是 Renderer UI 新增、抽取和公开组件的权威准入规范。它解决三个问题：能力是否应该进入本包、进入后由谁
拥有哪些合同、怎样证明 Host 与插件可以长期安全依赖。名字看起来通用、DOM 相似或当前目录不好归类，都不能
单独构成抽包理由。

### 1. 归属准入

公开组件或 capability 必须同时满足以下条件：

1. 已有至少两个独立业务 owner 的真实消费者，或已经存在可证明的重复实现；只有一个消费者时，默认先留在该
   app/domain/feature 内。包内组件为了实现既有公开能力而使用的内部构件不受消费者数量限制，但不能因此自动导出。
2. 各消费者复用的是同一语义、交互和变化原因，而不只是外观相似。例如“模型选择”和“画布对象菜单”都像下拉框，
   只有共同的选择/菜单机制属于本包，模型准入和画布命令仍属于各自业务。
3. 能力不读取业务 store、schema、权限、持久化、网络、Electron preload 或插件私有合同；调用方可以通过窄
   props、events、slots、resolver 或 browser-safe port 提供所需事实。
4. 本包可以完整拥有稳定的展示与交互合同，业务 owner 继续拥有业务规则、校验、异步流程、错误解释和状态编排。
5. 上移后能够删除原实现、复制样式或临时 facade，保持一个源码和一个 CSS owner；禁止以兼容为名长期保留双真源。

不满足以上条件时，组件应留在最近的 feature 或 domain。多个 feature 只在同一 domain 内复用时，应先进入该
domain 的 `shared`，而不是直接上升为全局 Renderer UI。未来出现第二个真实 owner 后，再以实际用例提炼共同合同。

以下内容明确不进入本包：业务表单和流程、读取 Host 状态的容器、业务实体卡片、带业务语义的 toolbar、插件品牌
组件、业务 schema/DTO decoder、权限或网络适配器，以及只为单一页面整理目录而创建的“通用” wrapper。

### 2. 组件职责与交互设计

- 组件只负责展示、浏览器交互和显式状态连接。能从输入确定计算出的规则放入同 feature 的 `functions/`；多步骤
  DOM 生命周期或交互协调才进入 `orchestration/` 或窄 composable，Vue 文件保持薄。
- 状态所有权必须明确。受控值使用严格类型的 props/`v-model` 和语义事件；组件只持有输入草稿、展开态、hover、
  focus、拖拽中位置等局部瞬时 UI 状态，不建立全局 store，不暗藏业务缓存、网络请求、持久化或跨业务 timer。
- 使用正确的 HTML 元素、label、role 和 `aria-*` 关系；键盘操作、焦点可见性、禁用态、关闭与焦点归还必须与
  组件语义一致。不能用仅鼠标可达的 `div` 模拟按钮，也不能把无障碍名称固定成某个业务文案。
- 只实现真实场景，不为猜测中的未来需求加入 fallback、模式开关或大而全配置。两个用例的行为确实不同且都稳定时，
  才建立有语义名称的 variant；差异属于业务时由 wrapper 或 slot 组合，不把组件扩张成上帝组件。
- 新组件必须定义它真实适用的状态，包括默认、hover、focus-visible、active、disabled、open/closed、loading、empty、
  error 中的相关子集。不存在的状态不要为了清单制造；存在的状态不能留给各消费者各自补样式。
- 抽取既有组件时只移动 owner，不改变 UI、UX、文案、交互、动效、焦点、滚动或加载时序。发现 bug、可访问性欠账
  或更合理的新设计时单独登记；涉及默认行为、危险动作、键盘语义、动效或信息层级变化的事项必须作为产品变更决策，
  不能夹带在组件抽取中。

### 3. 公共 API 合同

- props、events、slots、公开 types、默认值和必填性必须严格类型化；禁止 `any`、不安全断言和手写近似声明。
  公共类型放在对应 feature 的 `definitions/`，实现和导出引用同一份事实。
- API 使用 UI 语义命名，不暴露业务对象、Host store 结构、内部 DOM 层级或实现库类型。组件只接收完成展示和交互所需
  的最小数据；复杂业务对象应由调用方先投影成公开 option/value/section 等窄合同。
- 值更新必须有唯一、可解释的时机。`update:modelValue`、提交事件、取消事件和关闭事件不得重复表达同一结果，也不得
  让消费者猜测 blur、Enter、outside-click 或卸载是否会提交。
- 普通内容优先使用 props；需要调用方拥有结构或业务 UI 时使用命名 slot；需要复用浏览器事实时使用窄 port。
  不要用自由 HTML 字符串或任意 callback 绕过 Vue 组合与内容安全。
- 扩展顺序固定为：已有语义 prop/variant → slot → 明确节点的 `classNames`/属性映射。只有多个真实消费者需要稳定
  定制同一内部节点时才增加扩展面；内部 selector、DOM 顺序和 transition name 默认均为私有实现。
- `class`、`style`、`aria-*` 和 `data-*` 落在哪个真实节点必须明确。组合控件若不能安全自动透传，应关闭
  `inheritAttrs` 并提供命名清晰的 root/control/button attributes 或 class 合同，不能静默丢失属性或落到错误节点。
- 新能力优先进入现有 feature 入口。只有运行环境、依赖闭包或交付策略确实不同，才新增 package subpath；禁止为了
  文件分类制造公开入口。删除、重命名或改变交互语义必须按本包版本规则处理，不保留旧 API 转发层。

### 4. 视觉、样式与布局

- 颜色、间距、圆角、阴影、字体、层级和状态视觉优先消费现有 semantic/component token。只有跨业务语义稳定且
  现有 token 无法表达时才新增 token；原始色值只允许出现在 foundation/theme owner，业务内容色不得上移。
- 新增 token 必须在 `light`、`dark`、`moon-blue` 中语义一致且集合闭包完整。组件不得读取主题 store、判断主题 ID、
  依赖 Host 主题 class，或让插件覆盖 package 保留 token。
- 样式必须由组件所在 feature 拥有并汇入唯一 [`styles.css`](./src/styles/styles.css)；组件和插件都不得再次导入或复制
  package CSS。禁止 `scoped` style、Host/domain CSS 反向补丁和业务对 package 内部 selector 的覆盖。
- 组件必须自包含必要的 `box-sizing`、字体继承、line-height 和原生 appearance，不依赖 Host reset。禁止新增
  `*`、`html`、`body` 或裸 `button/input/select/textarea` 等无 owner 全局规则。
- 新增内部 class、transition name 和 keyframes 必须使用 Renderer UI 包级命名空间；推荐
  `linnya-ui-<feature>-*`。既有迁移名称不因此自动成为公共 API，也不得复制为第二套选择器。
- 根组件不得假定 AppLayout 尺寸、侧栏宽度、编辑器缩放或固定页面背景。需要尺寸、容器边界或滚动 owner 时由公开
  合同明确表达，并在小视口、内容增长和长文本下保持可访问。
- 跨 owner overlay 只能使用 `--linnya-ui-layer-*` 和 `rendererUiOverlayLayer()`；禁止新增任意大 `z-index`。
  Teleport 后的主题、层级、焦点和样式闭包必须与原位置一致。
- 动效必须说明触发条件、结束状态和中断行为。新增动效同时定义 `prefers-reduced-motion` 语义；迁移既有动效时保持
  原样，不能借抽包改变节奏或减少动效。

详细视觉约定继续遵循 [Renderer 样式指南](../../apps/renderer/app/styles/guide/style-guide.md)。README 登记的公开
token、surface class、root extension class 和 data attribute 才是 CSS API。

### 5. 文案、图标与依赖边界

- 组件自身真正跨业务的默认文案进入 `/localization` 的 message catalog，并同时提供正式 fallback；业务标题、实体名、
  错误解释和操作结果由调用方传入或通过业务 resolver 解析。完整规则见
  [本地化指南](../../docs/i18n/LOCALIZATION_GUIDE.md)。
- 无业务语义的平台图标从 `/icons` 复用。品牌图标、业务实体图标和只随某个插件演进的图标留在真实 owner；禁止在
  新组件模板里复制已有 SVG。
- 包根和 UI feature 只允许 Vue public API、DOM/browser API、包内稳定切片和已审核的 browser-safe runtime 依赖。
  新增第三方依赖必须证明不能由现有能力表达、浏览器安全、许可证可接受，并进入 package runtime dependency 与
  tarball 验证；不能把 Host 已安装依赖当作隐式可用。
- 浏览器环境差异通过窄 port 注入事实，不得扩张为 Host service locator。`/font-stack` 等纯叶子入口继续遵守自己的
  更窄依赖闭包，不能因为根入口需要 Vue/DOM 就放宽限制。

### 6. 目录、测试与交付

新能力按语义归入 `src/features/<capability>/`。根据实际需要使用 `definitions/`、`functions/`、`orchestration/`、
`ports/`、`ui/`、`styles/`；只在单个 feature 内复用的实现留在该 feature 内，禁止新增 `utils`、`helpers`、
`common`、`service` 或新的顶层 `components` 杂物目录。一个组件的类型、纯规则、Vue UI、样式和行为测试应由同一
feature 拥有。

新增或抽取公开能力至少完成以下验收：

1. 为真实交互合同补行为测试：值更新、提交/取消、键盘、focus、disabled、outside-click、Teleport、滚动、拖拽等
   只覆盖组件真实支持的子集。测试业务结果和无障碍不变量，不锁 padding、具体颜色、README snapshot 或大面积 UI snapshot。
2. 在三个内置主题和真实相关状态下人工检查；抽取任务还要在每个 Host/官方插件消费者中对照迁移前的 UI、UX、文案、
   键盘、滚动和动效，独立 harness 不能替代真实页面验收。
3. 更新 feature/style 聚合、公开 index 和类型导出。新增或改变公开入口时，同时更新 `package.json` 与
   [`rendererUiRuntimeEntryCatalog.mjs`](../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs)；Host provider、
   plugin protocol、external map 与 import map 继续从该 catalog 投影，并由现有一致性测试对账，不得另建手写入口表。
4. 更新本 README 的公开入口、[使用指南](./docs/usage-guide.md) 和 [CHANGELOG](./CHANGELOG.md)，说明适用与不适用场景、
   状态所有权、扩展面、可访问性、已知限制和真实迁移影响，并按 [发布检查表](./docs/release-checklist.md) 判断版本级别。
5. 运行 `pnpm --dir packages/renderer-ui run gate`。涉及 Host 或插件消费者时，再运行 frontend build、受影响插件
   typecheck/build/artifact smoke 和 Renderer UI runtime boundary 门禁；新增 subpath、runtime dependency 或交付方式时必须
   扩展 packed consumer smoke。
6. 抽取完成后删除原实现、CSS、re-export、alias 和临时 facade，并用搜索确认没有生产 deep import 或内部 selector
   覆盖。若不能一次完成单一 owner cutover，该能力不得以“已抽包”状态交付。

提交评审前，作者必须能用大白话回答：谁在复用、共同语义是什么、业务边界在哪里、状态由谁拥有、键盘和焦点如何
工作、样式如何扩展、哪些是公共合同、哪些是私有实现、怎样验证 Host 与插件没有回归。任一问题没有明确答案时，
先把能力留在原 owner 或补设计，不通过增加开关和 fallback 推迟决定。

## 版本与发布

`1.0.0` 是 JS、CSS、token、主题、overlay 与 scroll 的首个稳定共同基线；`package.json.version` 与
`/version` 的 `RENDERER_UI_VERSION` 必须一致。删除/重命名公开能力、改变必填性、事件 payload、slot、交互语义、
主题 selector 或公开 token 语义都属于 major；向后兼容新增属于 minor；不改变合同的实现修正属于 patch。

renderer 插件必须让 `package.json.peerDependencies['@linnya/renderer-ui']` 与
`plugin.json.compat.rendererUi` 使用同一 range，开发依赖使用 `workspace:*`。组件、图标、本地化、scroll、theme
等 JS runtime 入口在插件 artifact 中保留 `plugin://host/renderer-ui/*` external，由 Host 提供单一 runtime；
`/font-stack` 纯叶子入口由插件与 hidden worker 直接 bundle，不依赖 Host 协议。兼容 patch/minor 不要求重建仅使用
Host external 的插件；改变已 bundle 纯叶子行为时必须按实际 artifact 影响决定是否重建。不兼容 major 会在商店检查、
远程安装和运行时加载三条链的任何 JS/CSS 副作用前被拒绝。

Linnya 已进入开源筹备期，因此不建立临时私有 GitHub Packages 渠道。`Linnya` 是产品名，当前 `@linnya` 是
workspace/runtime 的产品逻辑 namespace，不是 GitHub 或 npm 身份声明。已确认的 D7-C 要求首次开源只在公共 `linnlabs/linnya` 仓库中开放本包源码、文档和边界门禁；
本包在开源前后都保持 `@linnya/renderer-ui`、workspace-only 与 `private: true`，不发布公共 npm package。

真实 tarball consumer gate 继续验证 public exports、DTS/CSS、Vue runtime 与无 Host 偶然依赖，但该 tarball 是 CI/官方装配的验证产物，不自动上传 npm 或 GitHub Release。未来如出现真实仓外 consumer，必须通过公开 issue / PR 明确 registry、scope、版本承诺和运营 owner。
公开边界以根 [README](../../README.md)、[开发指南](../../docs/development/README.md) 与[文档治理规则](../../docs/documentation-governance.md) 为准。
变更版本时必须按 [版本与装配检查表](./docs/release-checklist.md) 执行，并更新 [CHANGELOG](./CHANGELOG.md)。

## Overlay 层级

跨 owner 浮层统一使用 `--linnya-ui-layer-*` token；JS 定位使用 `rendererUiOverlayLayer()`，不得在 package 组件或插件全局浮层中另写任意大数。当前 token 只把迁移前层级命名化：inline menu 100、picker 120、popover 与 status 1000、floating panel 1001、modal 2000、alert 与 portal menu 2100、image preview 3000、tooltip 4000。

Alert 与 portal menu 保持同层是现有行为，仍由同层 DOM 顺序决定，不表示已经建立统一弹层栈。迁移期间禁止借 token 重排前后关系；完整 Esc/focus/stack manager 属于独立交互演进。

`Modal` 只拥有通用遮罩、标题、关闭入口、视口尺寸约束、`content|internal` 滚动模式和可选 footer；业务表单与流程继续归调用方。`AlertDialog` 保持现有确认/取消/关闭事件投影，并支持结构化 section 和风险文案；危险样式优先由 `isDangerousAction` 明确声明，当前仍保留既有中英文文案推断以确保迁移等价。`ImagePreviewModal` 的 `classNames` 只向 overlay 和 image 节点注入业务命名空间 class，不把内部 selector 变成公共 CSS API。

当前 Modal 没有 focus trap、统一 Esc stack 或关闭后焦点恢复，AlertDialog 也保留迁移前的键盘监听时机。它们是已登记的交互/可访问性欠账，不得在纯 owner 迁移中用临时判断改写；后续必须单独设计、决策和验收。

## 日期与时间

`SimpleDatePicker` 保持图标触发、固定 42 格月历、禁用跨月日期、月份/年份切换、点击外部关闭和基于可见裁剪边界的上下放置；选中日期只替换年月日，保留原有时间。业务需要调整触发器视觉时只能通过 `classNames.trigger` 注入自己的命名空间 class。

二者的外层面板均支持 Escape 和点击外部关闭，关闭不会提交值。`TimePicker` 保持 0–23 小时和五分钟步长作为新选择集合；已有值若不是五分钟整点，分钟选择器会把当前真实分钟补入排序后的选项，不舍入或改写业务数据。确认只替换时分并清零秒与毫秒。

## 颜色选择

`ColorPickerPanel` 只拥有文本色/背景色网格、当前项匹配、清除入口和通用视觉。业务色板以 `ColorPickerOptionDefinition<LabelKey>` 定义，通过 `createColorPickerOptions` 构造；业务 catalog 使用 `labelResolver` 解析自己的文案键。`--block-*` 等内容颜色、色板顺序、标题与清除语义仍由 Editor、Sheet 等真实 owner 决定，不属于 package token 或本地化 catalog。

需要比较持久化业务值时使用 `by-value`；业务状态保存解析后的主题色时使用 `by-resolved-hex`。后者通过当前 CSS 变量解析颜色，并在变量缺失时使用 option 的显式 `fallbackHex`。业务不得覆盖 `.shared-color-picker-panel__*` 内部 selector。

## 可拖拽面板

`DraggablePanel` 支持五种初始位置、数字或四边 position offset、可选容器边界、固定/auto 尺寸、拖拽和八方向 resize。`variant="mini"` 保留轻量筛选/查找面板的既有密度；auto 宽度或高度会隐藏对应方向的 resize 手柄。组件继续阻止根节点和拖拽手柄的 `mousedown`/`touchstart` 冒泡，避免画布把面板交互误判为框选、节点拖拽或平移。

普通原生属性会落在面板根节点；业务需要交互标记时由自身显式传入。指定内部节点的业务样式只能通过 `classNames.header/title/closeButton/body` 注入业务命名空间 class，不得覆盖 `.draggable-panel .panel-*` 等内部 selector。位置与 resize 规则同时以纯函数公开，供不渲染 Vue 的边界测试和同语义编排复用。

## 悬浮提示

`HoverTooltip` 只承载简短、不可交互的说明。真实指针移动到触发器时显示；键盘导航形成 `focus-visible` 时显示；触摸移动不显示。窗口失焦会清除当前提示和输入来源，重新激活窗口本身不会恢复旧提示，必须等待下一次真实指针或键盘输入。上下放置、8px 默认间距、水平视口约束、Teleport、过渡、DOM class 与 tooltip 4000 层级均保持迁移前结果。

包内只监听标准 browser 事件，不读取 Electron preload。Electron Host 在 app composition 中通过 `HOVER_TOOLTIP_WINDOW_FOCUS_PORT_KEY` 提供 `HoverTooltipWindowFocusPort`；Host 组件树中的插件自然继承该 port，无需也不得自行接触 Electron。独立 browser consumer 未注入时直接使用 browser-only 语义。该端口只传递窗口焦点事实，不得扩展为 Host UI 状态或权限入口。

## 通知展示

`NotificationBar` 是无状态的通知 presentation，只由 `visible`、`message`、`type` 和数值 `right` 控制。它保留 success/error/info/warning 的原有字符图标、DOM class、单行截断、过渡和 status 1000 层级，不读取 Pinia，不创建 timer，也不在卸载时触发关闭。

Host notification feature 负责当前通知状态、自动关闭 orchestration 和 CharacterCount 避让位置；插件通过 Host workspace runtime 提交通知时也进入同一个 owner。独立 package consumer 可以直接渲染展示组件，但 package 不提供全局 toast queue 或业务错误解释。

文本输入控件把传入的普通 `class` / `style` 应用在组件根节点。业务 owner 如需在保持控件行为与结构不变的前提下调整原生 `input` / `textarea`，只能通过 `control-class` 传入自己的命名空间 class；`.tt-text-field__*` 等 package 内部 selector 不是扩展 API。`applyTextareaAutoResize` 供确实不能使用 `CustomTextarea` 的原生 textarea 场景复用，不包含业务状态和滚动策略之外的编排。

CustomNumberInput 同样把普通 `class` / `style` 留给根节点，原生 number input 只通过 `input-class` 扩展。`variant="panel"` 保留浮动面板外观；`inline-menu` 只服务 Renderer UI 内部的 CustomSelect 行内数字项，不应被业务页面用来表达新的视觉语义。

## 选择菜单与浮层

CustomSelect 统一拥有普通选择器、动作菜单、手动触发、Portal 定位、最多两级标准子菜单、行内数字输入和两种键盘所有权。`CustomSelectOption<Value>` 是唯一选项合同：组标题与分隔符不可选择；有 children 的父项默认只展开；确实需要父项同时可选时才使用 `allowDirectSelect`。动作菜单必须显式声明 `semanticRole="menu"`，编辑器持有焦点的场景通过组件公开的 `onKeyDown` 委托按键。

普通 `class` / `style` 只控制组件根节点。业务 owner 若需要保持组件行为不变并调整指定节点，只能通过 `classNames` 映射注入自己的命名空间 class；支持 trigger、selectedValue、arrowIcon、options、optionsHeader、submenu、nestedSubmenu、option、optionLabel、optionIcon、optionShortcut 和 optionArrow。`.select-*`、`.option-*`、`.custom-select__*` 都是包内实现，不是 CSS API。单个选项确有独立业务语义时，可使用 option 的 `className`、`labelClassName`、`iconClassName` 或 `shortcutClassName`。

`BaseDropdown` 只管理开关、点击外部关闭、Escape 和焦点归还，不接管业务面板内容。Teleport 内容必须通过 `externalContentRef` 告知组件。独立业务面板需要复用标准浮层外观时，使用 `DROPDOWN_SURFACE_CLASSES` 提供的公开 surface 类，禁止借用 CustomSelect 内部面板类。

`TextPopover` 提供 click/hover 两种触发方式与 auto/top/bottom/left/right 定位。`content` 保留现有 HTML 渲染合同，只允许传入应用自身生成的可信内容；外部或用户输入应通过 content 插槽按普通文本渲染。

## 边界

包根和 UI feature 允许依赖 Vue public API、DOM/browser API、包内稳定切片和经审核的 browser-safe UI 依赖。
Vue 是 peer dependency，Host 与插件必须共享同一实例。`/font-stack` 是刻意更窄的 worker-safe 叶子，只能依赖显式输入与
包内纯类型/纯函数；禁止引入 Vue、DOM、CSS、Electron、Node、Host 状态或 package 根桶。

禁止依赖 Host app/domain/store、Electron/Node、`src/plugin-sdk`、`@plugin/renderer/*`、插件私有包或业务网络/持久化/权限流程。CSS 不得依赖 Host reset、业务主题文件或插件样式。

目录按 UI 能力组织；feature 内按需使用 `definitions/`、`functions/`、`ui/`、`styles/`。禁止把包根演变成新的 `components` 杂物间。

## Theme 与 token

内置主题为 `light`、`dark`、`moon-blue`，统一由 `documentElement[data-linnya-ui-theme]` 激活。Host 负责读取和持久化用户选择，只能通过 `/theme` 的类型与常量装配 DOM；组件和插件不得读取 Host theme store，也不得按主题 ID 写视觉分支。

`tokens.css` 拥有 foundation、通用 semantic、functional、geometry、typography 和跨 owner 稳定复用的 component token。App layout、Conversation、Editor 等业务 token 留在各自 owner，并在 package 样式之后装载。公开 token 的删除、重命名、语义变化或主题集合缺失都按 breaking change 处理。

## Scroll

`/scroll` 保留既有 DOM 作为真实 viewport，统一 OverlayScrollbars 生命周期、默认 preset、按帧合并更新与结构动画期间的 metrics 协调。业务层继续拥有吸底、虚拟列表、画布等规则，只把 DOM bindings 和局部 options 交给 package capability。接入说明见 [`src/scroll/README.md`](./src/scroll/README.md)。

## 样式装载

Host 只加载一次 `/styles.css`，顺序固定为：Host reset/document baseline → Renderer UI → Host app/domain/feature → plugin-owned stylesheet。插件不得导入 package CSS，也不得覆盖 package 保留 token 或内部 selector。

## 独立门禁

运行 `pnpm --dir packages/renderer-ui run gate`。该命令独立执行 Vue/TypeScript 检查、ActionButtons/font-stack/selection/theme/scroll/localization/Tooltip/Notification 行为测试、CSS token/theme/资产闭包审计，并把真实 tarball 解包后交给一个最小 Vite/Vue consumer 构建。consumer 会真实导入并渲染 ActionButtons、ColorPickerPanel、DraggablePanel、HoverTooltip、NotificationBar 与 `/icons` 图标，并调用 `/font-stack`、颜色/面板/Tooltip 定位纯函数和 `/localization` fallback；发布内容、显式 exports、runtime dependency、Vue SFC、CSS side-effect 与固定 `tokens.css`/`styles.css` 身份因此不依赖 Host 源码碰巧存在。
