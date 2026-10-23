# chart-reading：图表的只读呈现与阅读交互

把一份已准入的 `MarkdownChartSpec` 画成图，并提供会话级的查值、图例筛选/突出，以及复制为图片或 Markdown。
当前图表工具栏暂不展示编辑、数据表与范围筛选入口。数据表读模型与范围筛选规则保留，供既有剪贴板合同与后续界面复用。
它不拥有规格（`@app/schemas`）、不拥有块节点（`blocks/ChartBlock`）、不拥有源码编辑（`features/chart-editing`），也不写文档：阅读状态不进入正文、版本、Pending、undo 或剪贴板。

## 公开入口

[`index.ts`](./index.ts) 只导出：`ChartSurface`（外壳组件）、阅读状态键 `ChartReadingKey` / `ChartReadingVariant`、会话清理
`createChartReadingSessionId` / `disposeChartReadingSession` / `disposeChartReadingBlock`，绘图区尺寸合同 `plotHeightOf`（块估高复用），以及数据表读模型 `buildChartDataTable` / `chartDataTableToTsv`（剪贴板 HTML 复用）。
ECharts 运行时、主题解析和阅读规则都是内部实现，其他模块不得绕过出口引用。

`renderChartPrintImage` 是文档打印的窄入口：从完整规格生成包含标题、说明、图例和脚注的静态 SVG 图片，固定浅色默认视图；内部复用复制图片的构图与 SSR 渲染，不读取会话状态或已挂载图表。

`ChartSurface` 的 props：`spec`、`readingKey`（`null` 表示状态只在该组件内，用于编辑预览与历史视图）、`active`（是否持有 ECharts 实例）、`transitions`（是否允许更新过渡）；
工具栏只展示“复制图标 + 右箭头”的复制菜单；阅读视图改变后另提供恢复默认视图。控件高度与其他块的标准图标按钮一致。
菜单复用 `CustomSelect` 的公开 `classNames.options`，在图表内向左展开，宽度随文案自适应。
复制图标为 18px，辅助箭头沿用文本工具栏的 12px；箭头直接读取触发器的 `aria-expanded`，展开时由右向下旋转，关闭时复原，时长与减少动态效果规则遵循 Renderer UI 设计规范。

## 分层

```text
definitions/    纯类型与常量：阅读状态、渲染上下文、主题 token 与色系（chartTheme.ts）、option 形状
functions/      纯规则：阅读状态变换、域与刻度、图例、数据表、数字格式、过渡判定、色彩运算(chartColorSpace / chartPalette)、option 构建(option/)
orchestration/  副作用与时序：ECharts 懒加载与实例控制、主题读取、导出图片、useChartSurfaceRuntime
store/          会话级阅读状态（Pinia，只同步持有状态，不含规则，不持有 ECharts 实例）
ui/             薄 Vue：ChartSurface / ChartLegend / ChartReadingOptions / ChartDataTable
testing/        测试用固定数据（八类图表）
```

## 关键约定

- **按需加载**：ECharts（core + `SVGRenderer`）与四个图表家族（cartesian / scatter / share / radar）只在文档里出现图表并进入可见/预热区域时 `import()`；
  家族注册幂等，加载失败清除缓存允许重试。ECharts 实例只认识创建前已注册的家族，所以切换家族（如柱→饼）会重建实例。
- **色板与顺序**：六套单色阶 `verdant`（默认）、`teal`、`aqua`、`violet`、`warm`、`mono`，三套多色色带 `sea`、`pastel`、`mist`，每套八色。`chartTheme.ts` 的数组就是视觉顺序，禁止交错取色。
  取色依据完整规格中的实体位置和数量：少于八类用递增子序列，多色色带的五类使用核心五色；八类使用全部；更多实体沿相邻色插值，不循环回第一色。作者应优先拆图或聚合，颜色不能独立承担高密度身份识别。
  分组/堆叠按系列取色，饼/环与 `bar.colorBy: category` 按类目取色；筛选、聚焦、默认视图导出都共用同一规则。后者坐标轴已有标签，默认不重复图例。
  显式 `color` / `pointColors` 保留作者色值；普通柱的 null 沿用系列色，按类目着色时沿用类目默认色。多色色带在亮暗主题保留原色，单色阶按主题调整明度；细线只在对背景不足 3:1 时调整明度，保持色相，不把原色统一压灰。
- **正文呈现**：标记规则集中在 [`chartMarkStyle.ts`](./functions/option/chartMarkStyle.ts)。柱、扇区、散点与图例键无装饰性描边；折线保留真实观测点和行末标签；面积低透明度平铺，网格为中性发丝实线。外壳无边框、无独立底色；环形厚度为外半径的 34%，扇区不加圆角以保持比例。
  文字与表面读取 renderer-ui 语义 token。数量标签使用常规字重；百分比堆叠标签显示完整分母下的份额，tooltip 与数据表保留原始数量。
  文档中的块间距与选中提示统一由 RootBlock 管理，图表不额外叠加绿色描边或光圈；标题沿用标题块的内容起点，NodeView 与阅读外壳不再添加上下留白。
- **行末直标**：折线/面积在不超过 5 个系列且没有显式 `legendPosition` 时，在行末直接标出“系列名 + 末值”，不再放图例。系列名是不可信文本，进入富文本标签前先净化花括号。
- **确定性版面**：绘图区只有三档高度（240/320/420 px），标题与说明是 DOM 自然排版；加载、离屏占位与最终图之间没有版面跳动。
- **阅读不改变数据语义**：数值轴域、百分比堆叠的分母与颜色都按完整规格计算；隐藏系列或聚焦范围不重新拟合坐标轴、不重新分配颜色。
  饼/环只能突出，不隐藏组成部分，也不重算分母。
- **悬停只查值**：绘图区与图例的鼠标移入、移出和键盘聚焦都不改变其他数据的透明度；关闭 ECharts 自动 emphasis/blur、缩放与线宽变化、坐标提示器独立触发的高亮，并移除图例的临时高亮事件链路，避免快速划过时整图闪动。tooltip 与轴指示仍可使用；图例的明确点击仍可筛选系列或突出某个部分。
- **阅读状态**：按 Editor 会话 × 块身份 × 展示用途（`document` / `proposed` / `baseline`）隔离；规格语义变化（数据/类型/轴语义）时重置，主题、宽度、`size` 变化保留有效状态。
  状态同时保存规格语义键，重新挂载也核对离屏期间的数据变化。关闭文档（会话清理）与删除块（`ChartBlock` 的 `onTransaction`）时释放。
- **过渡**：只在同一已挂载图表里、类型与坐标语义不变且系列/观测对象可以由内容确认对应时，对合法数据更新或读者主动操作播放短过渡；身份来自系列名、类目键或唯一 `pointLabels`，
  身份键也写入 ECharts 数据项，关闭用户系统“减少动态效果”才允许过渡；展示属性变化完全替换 option，避免旧样式残留。从不按数组下标猜测。首次加载、主题/语言/容器变化、再入屏、编辑预览、Pending 对照和导出一律直接显示最终结果。
- **安全**：规格是纯数据；tooltip 的文本一律以 `textContent` 写入，字体族中的双引号规整为单引号（否则 SVG 不是合法 XML）。
- **复制菜单**：图片始终使用默认视图（不带筛选、聚焦与悬停），关闭动画并等待最终布局；Markdown 使用 schemas 的完整 canonical 围栏，不丢弃筛选隐藏的数据。两种失败分别报告。
- **数据表**：完整规格读模型仍供块剪贴板的 HTML 表格使用；独立查看面板暂不展示。
- **无障碍名称**：图形的类型与标题、说明由 `ChartSurface` 提供；标题与说明的 ID 使用浏览器 UUID，避免独立 Vue NodeView 根复用 `useId` 后关联到首图标题。关闭 ECharts 自动数据描述，避免把堆叠内部维度与 `NaN` 读给用户。当前隐藏数据表入口后，完整数据可通过复制 Markdown 或块复制的 HTML 表格取得。

## 验证

```bash
pnpm exec vitest run apps/renderer/domains/editor/features/chart-reading
```

`buildChartOption.test.ts` 用真实 ECharts SSR 渲染八类图表并在任何 ECharts 日志（warn/error）时失败；`chartInstanceController.test.ts` 覆盖实例创建、家族切换、释放与泄漏。
视觉质量（排版、配色、亮暗主题、真实 NodeView 交互）不能由这些测试证明，需要在真实应用里用样张和整篇文章验收。

验证重点是完整实体集上的顺序映射、筛选/聚焦不重分配、显式色优先、图例/提示框/导出一致与真实渲染，不用颜色快照或相邻色差阈值代替审美验收。

研究数据保真：饼图扇区不设置最小角度；未指定数字格式时保留数值有效精度；单侧显式轴界限之外的数据产生有效自动域。
