# Renderer UI 设计规范

本文补充 [Renderer UI README](../README.md)，定义 Linnya 界面的视觉语言：颜色层级、字阶、间距、圆角、边框、动效、交互状态和图标应该怎样取值、为什么这样取值。它面向 Host、官方插件和新增组件的作者。

事实来源分三层：token 的名称与数值以 [`src/styles/tokens/`](../src/styles/tokens/) 为准；组件 API 与行为以 README 和[使用指南](./usage-guide.md)为准；CSS 归属、选择器命名与样式装载等工程规则以 [Renderer 样式指南](../../../apps/renderer/app/styles/guide/style-guide.md)为准。本文只解释如何在这些 token 之间做选择，不复制完整清单。

## 1. 设计原则

1. **内容优先，界面退后。** 对话正文、文档和用户数据是主角；控件、边框和装饰只在需要时出现。能用留白、字重和表面层级表达分组时，不加线框。
2. **层级来自表面与文字，而不是线条。** 一条视线从页面向内最多穿过一层闭合边框。已经有边框的容器（输入框、卡片、对话框、菜单）内部，按钮和分区不再各自描边，改用透明底的 hover 背景或单边分隔线。
3. **每个值都来自刻度。** 字号、间距、圆角、层级、时长和缓动只从本文的刻度取值。刻度不够用时先讨论是否该新增 token，而不是在业务 CSS 里写一个“刚好合适”的数。
4. **动效说明因果，不做装饰。** 动效只用来解释“这个东西从哪里来、到哪里去、状态变成了什么”。它必须短、可中断，并在用户要求减少动态效果时立即完成。
5. **三套主题语义一致。** `light`、`dark`、`moon-blue` 只改变数值，不改变语义：同一个 token 在三套主题里表达同一层级，文字对比度在每套主题里都满足 WCAG AA。
6. **品牌克制。** 品牌绿只用于主操作、选中、焦点和可交互强调。它不表达警示、错误或“特别重要”，也不用作大面积背景。

## 2. 颜色

### 2.1 表面层级

| token | 用途 |
| --- | --- |
| `--color-bg-default` | 页面与内容画布，例如对话流、文档编辑区 |
| `--color-bg-sidebar` | 侧栏与导航区 |
| `--color-bg-surface` | 独立面板与卡片 |
| `--color-bg-elevated` | 浮在其他表面之上的菜单、弹出层和对话框 |
| `--color-bg-subtle` | 凹陷区域：代码块、只读值、轻量标签底色 |

浅色主题下 default、surface 与 elevated 都接近白色，层级主要靠边框和投影；暗色主题下表面逐级提亮（页面最暗）。因此**同一层内容只能使用一种表面 token**：如果一个区域在浅色下“看起来和页面一样”，就应该使用 default，而不是碰巧同为白色的 surface，否则暗色下会出现一块不同底色的接缝。

由多个子组件拼成的复合区域（例如对话宿主的消息画布、输入区背板和渐隐带）应由根组件暴露一个背景变量，子组件统一引用它；所在页面只覆盖这个变量，不分别覆盖子组件背景。

### 2.2 文字层级

| token | 用途 | 最低对比度 |
| --- | --- | --- |
| `--color-text-primary` | 正文、标题、主要标签 | 7:1 |
| `--color-text-secondary` | 次要正文、说明、未选中的导航项 | 7:1 |
| `--color-text-tertiary` | 元信息、时间、辅助说明 | 4.5:1 |
| `--color-text-muted` | 弱化的标签与图标 | 4.5:1（页面背景） |
| `--color-text-placeholder` | 输入占位与可忽略的提示 | 3:1 |

对比度按 `--color-bg-default` 计算；放在 surface 或 elevated 上时仍须满足 AA。层级按上表递减，暗色主题的 primary 不使用纯白，以减少深底上的光晕。不要用降低 `opacity` 的方式制造次要文字，透明度会随背景变化而失去可控的对比度。

### 2.3 边框

- `--color-border-light`：容器的默认描边和分隔线；`--color-border-default`：需要被看清的控件边界；`--color-border-hover` / `--color-border-focus`：交互中的控件边界。
- 暗色主题的边框是叠加在表面上的透明白色，在任何一级表面上都保持同样的可见度；新增暗色视觉不要用某个固定灰色当边框。
- 需要细线时使用 `--border-width-hairline`：高分屏上是物理 1px（0.5 CSS px），普通屏为 1px。
- 区域内部分组用单边分隔线（`border-top` / `border-bottom`），不再嵌套闭合方框。

### 2.4 强调色

`--color-accent*` 是品牌绿的语义映射，用于主按钮、选中项、激活中的开关与 Tab、焦点环和可交互链接性强调。`moon-blue` 主题把强调色映射为蓝色，因此组件只能引用 `--color-accent*`，不能直接写品牌色阶。

### 2.5 功能色

每种状态有三类 token，用途不能互换：

| 类别 | token | 用途 |
| --- | --- | --- |
| 基础色 | `--color-success` / `-error` / `-warning` / `-info` | 图标、描边、进度条、状态点 |
| 文字色 | `--color-*-text` | 状态文字；在对应 `*-bg` 与页面背景上满足 AA |
| 背景色 | `--color-*-bg` | 提示条、徽标和状态胶囊的底色 |

基础色不保证作为文字可读（例如警示黄），状态文字必须使用 `*-text`。状态语义固定为：错误和失败用 error；需要用户处理但未失败（不可用、已过期、配额将尽）用 warning；完成用 success；中性提示用 info。状态不能只靠颜色表达，必须同时有文字或图标。

## 3. 字体

### 3.1 角色字阶

业务 UI 按内容角色选择字号，字号与行高成对使用：

| 角色 | 字号 / 行高 | 用途 |
| --- | --- | --- |
| `caption` | 11 / 16 | 徽标、计数、时间戳、快捷键提示 |
| `footnote` | 12 / 18 | 辅助说明、表单提示、紧凑控件、表头 |
| `body` | 13 / 20 | 默认界面文字：菜单、列表行、按钮、侧栏、表单控件 |
| `prose` | 14 / 22 | 需要连续阅读的文字：对话消息、输入框、设置说明 |
| `subtitle` | 15 / 22 | 卡片标题、空态副标题、对话框分组标题 |
| `title` | 18 / 26 | 对话框标题、页面分区标题 |
| `headline` | 22 / 30 | 页面标题 |
| `display` | 28 / 36 | 空态和首屏的主视觉文字 |

对应 token 为 `--font-size-<role>` 与 `--line-height-<role>`。`--font-size-xs` … `--font-size-3xl` 是基础刻度，只在 token 层和文档内容排版（例如编辑器标题层级）中使用。单行控件需要文字与图标垂直居中时可以使用 `line-height: 1`。

### 3.2 字重

只有三档：`--font-weight-regular`（400）用于正文，`--font-weight-medium`（500）用于按钮、标签和需要强调的界面文字，`--font-weight-semibold`（600）用于标题。CJK 字形在 700 下过重，强调不使用 bold。

### 3.3 数字与长文本

会变化的数字（计数、用量、计时、表格数值）使用 `font-variant-numeric: tabular-nums`，避免数值变化时整行抖动。可能出现超长无空格字符串（路径、ID、URL）的位置使用 `overflow-wrap: anywhere`，单行标题使用省略号截断并提供完整文本的提示。

## 4. 间距

间距使用 4px 网格，token 编号乘以 4 即像素：

| token | 像素 | 典型用途 |
| --- | --- | --- |
| `--space-0-5` | 2 | 紧凑控件内部的图标与文字 |
| `--space-1` | 4 | 图标与文字、同组按钮之间 |
| `--space-1-5` | 6 | 紧凑控件内边距 |
| `--space-2` | 8 | 控件内边距、列表项之间 |
| `--space-2-5` | 10 | 中等控件内边距 |
| `--space-3` | 12 | 卡片内边距、表单项之间 |
| `--space-4` | 16 | 面板内边距、组与组之间 |
| `--space-5` | 20 | 宽松面板内边距 |
| `--space-6` | 24 | 区块之间、对话框内边距 |
| `--space-8` | 32 | 页面分区之间 |
| `--space-10` | 40 | 页面级留白 |

半步（0.5、1.5、2.5）只用于紧凑控件内部。小于 2px 的光学校正可以写 1px，但不能因此复制一套几何常量。

`--spacing-xxs` … `--spacing-2xl` 是 2.x 已发布插件仍在按名称使用的旧别名，数值指向对应的 `--space-*`。仓内新代码不得使用，存量由刻度棘轮逐步收敛，下一个 major 删除。

## 5. 圆角

| token | 像素 | 用途 |
| --- | --- | --- |
| `--radius-xs` | 2 | 选区、进度条等细小标记 |
| `--radius-sm` | 4 | 标签、内联代码、复选框、紧凑图标按钮 |
| `--radius-md` | 6 | 按钮、输入框、菜单项等标准控件 |
| `--radius-lg` | 8 | 卡片、工具卡、菜单、弹出层与对话框 |
| `--radius-xl` | 12 | 大面板、对话输入框 |
| `--radius-2xl` | 16 | 空态首屏等大尺寸输入容器 |
| `--radius-full` | — | 胶囊、圆形头像和按钮 |

嵌套时内层圆角等于外层圆角减去两者间距（最小取 `--radius-xs`），让内外轮廓同心。纯圆形元素可以直接写 `border-radius: 50%`。

## 6. 投影与层级

- 投影只表达“浮起”：菜单、弹出层、对话框和拖拽中的元素。不要用投影代替边框，也不要用投影制造 hover 效果。
- 浮层使用 `--shadow-floating-panel`（自带一圈发丝描边），对话框使用 `--shadow-lg`，静止卡片最多使用 `--shadow-xs`。暗色主题的投影更重，组件不需要为暗色单独加深。
- 跨 owner 的浮层只能使用 README 中的 `--linnya-ui-layer-*` 层级。组件内部的局部堆叠用 0–9 的小整数；10 及以上的 z-index 必须来自层级 token。

## 7. 动效

### 7.1 时长

| token | 时长 | 用途 |
| --- | --- | --- |
| `--duration-micro` | 100ms | hover、按下等颜色与透明度反馈 |
| `--duration-short` | 150ms | 菜单、提示、开关等小型浮层与状态切换 |
| `--duration-medium` | 200ms | 展开收起、弹出层、Tab 指示器移动 |
| `--duration-long` | 300ms | 对话框、抽屉、面板滑入 |

元素越大、移动距离越远，时长越长；离开通常比进入短一档。

### 7.2 缓动

| token | 用途 |
| --- | --- |
| `--ease-standard` | 元素在屏内改变状态、位置或尺寸 |
| `--ease-enter` | 元素进入视图：快速出现，减速落定 |
| `--ease-exit` | 元素离开视图：加速收走 |

进度条、旋转加载等匀速运动使用 `linear`。不要使用 CSS 默认的 `ease` 或临时写的 `cubic-bezier`。

### 7.3 规则

- 优先只动画 `opacity` 与 `transform`；需要动画高度时使用 grid `0fr → 1fr` 等不触发逐帧布局的方式。
- 动效必须可以被打断：快速重复触发时从当前状态继续，而不是跳回起点。
- 用户开启“减少动态效果”时，四个时长 token 会被置为接近 0，经由 token 的过渡自动立即完成。直接写在关键帧里的循环动画（如加载指示）必须自行提供 `prefers-reduced-motion` 规则。
- `--transition-fast` / `--transition-normal` / `--transition-slow` 是 2.x 旧别名，分别指向 micro、medium、long；仓内新代码使用 `--duration-*`。

## 8. 交互状态

| 状态 | 表达方式 |
| --- | --- |
| hover | 透明底控件显示 `--color-bg-hover`；文字或图标可提升一级文字色 |
| active（按下） | `--color-bg-active`；需要触感时可加 `scale(0.98)`，时长用 micro |
| selected | `--color-accent-bg` 底色配 `--color-accent` 文字，或 `--color-bg-active-subtle` 中性选中 |
| disabled | 使用原生 `disabled` 语义，配合 `--color-text-placeholder` 或整体 0.5–0.6 透明度；不能只改颜色 |
| focus-visible | `outline: var(--focus-ring-width) solid var(--color-focus-ring)`，`outline-offset: var(--focus-ring-offset)` |

只在 `:focus-visible` 上显示焦点环，鼠标点击不显示。移除 `outline` 时必须提供等价的可见焦点样式。

## 9. 图标

平台图标从 `/icons` 获取，单色线性风格，颜色继承 `currentColor`。常用尺寸为 12（徽标、关闭）、14（紧凑工具条）、16（标准控件）和 20（卡片与空态操作）；同一行内的图标保持同一尺寸。图标用于帮助理解而非唯一表达，图标按钮必须有可访问名称。品牌标识 `LinnyaIcon` 只用于品牌位置，不作为普通操作图标。

## 10. 状态呈现

- **空态**：说明当前是什么、可以做什么，最多给出一个主操作；不展示不可用的“即将推出”控件。
- **加载**：结构已知的内容（列表、卡片）使用与最终布局一致的占位骨架；时长不确定的小范围操作使用行内加载指示。避免整块空白后再一次性出现。
- **错误**：就近展示，说明原因与可执行的下一步，使用 error 功能色；不要只用 Toast 告知需要用户处理的问题。

## 11. 刻度棘轮

`pnpm run guard:renderer-style-scale` 扫描 `apps/renderer` 与 `packages/renderer-ui/src` 的 CSS（token owner 文件除外），统计绕过 token 的写死值：

| 规则 | 统计内容 |
| --- | --- |
| `SCALE-01-font-size` | 带单位的字号 |
| `SCALE-02-font-weight` | 数字字重与 `bold` |
| `SCALE-03-line-height` | 0 与 1 以外的数值行高 |
| `SCALE-04-radius` | 非零长度圆角（`50%` 不计） |
| `SCALE-05-spacing` | `padding` / `margin` / `gap` 中大于 1px 的长度 |
| `SCALE-06-z-index` | 绝对值不小于 10 的 z-index |
| `SCALE-07-duration` | 过渡与动画中的非零时长 |
| `SCALE-08-easing` | `ease` 系列关键字与 `cubic-bezier()` |
| `SCALE-09-legacy-alias` | 旧别名 `--spacing-*` 与 `--transition-*` |

每个文件每条规则的数量记录在 `.baseline/renderer-style-scale.txt`，只允许减少：新增写死值会让 `pnpm run lint:style` 失败；减少后运行 `pnpm run guard:renderer-style-scale:update` 收紧基线。自定义属性的定义不在统计范围内，局部变量如果表达刻度值，应从 token 派生。

## 12. 新增或修改 token

1. 先确认现有 token 无法表达，且至少有两个业务 owner 需要同一语义；单处使用的值留在组件局部。
2. 主题相关 token 必须在三套内置主题中同时定义并满足本文的对比度要求；非主题 token 放在 `:root`。
3. 新增 token 属于 minor，删除、重命名或改变语义属于 major，按[版本与装配检查表](./release-checklist.md)处理，并更新本文与 [CHANGELOG](../CHANGELOG.md)。
4. 运行 `pnpm --dir packages/renderer-ui run gate` 与 `pnpm run lint:style`，并在三套主题下人工检查受影响页面。
