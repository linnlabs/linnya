# chart-reading：图表的只读呈现与阅读交互

把一份已准入的 `MarkdownChartSpec` 画成图，并提供会话级的阅读交互：查值、系列筛选/突出、类目与 X/Y 范围聚焦、数据表、复制为图片。
它不拥有规格（`@app/schemas`）、不拥有块节点（`blocks/ChartBlock`）、不拥有源码编辑（`features/chart-editing`），也不写文档：阅读状态不进入正文、版本、Pending、undo 或剪贴板。

## 公开入口

[`index.ts`](./index.ts) 只导出：`ChartSurface`（外壳组件）、阅读状态键 `ChartReadingKey` / `ChartReadingVariant`、会话清理
`createChartReadingSessionId` / `disposeChartReadingSession` / `disposeChartReadingBlock`，绘图区尺寸合同 `plotHeightOf`（块估高复用），以及数据表读模型 `buildChartDataTable` / `chartDataTableToTsv`（剪贴板 HTML 复用）。
ECharts 运行时、主题解析和阅读规则都是内部实现，其他模块不得绕过出口引用。

`ChartSurface` 的 props：`spec`、`readingKey`（`null` 表示状态只在该组件内，用于编辑预览与历史视图）、`active`（是否持有 ECharts 实例）、`transitions`（是否允许更新过渡）；
`actions` 插槽放块级操作（如“编辑”），读者的阅读操作是外壳自带的。

## 分层

```text
definitions/    纯类型与常量：阅读状态、渲染上下文、主题 token、option 形状
functions/      纯规则：阅读状态变换、域与刻度、图例、数据表、数字格式、过渡判定、option 构建(option/)
orchestration/  副作用与时序：ECharts 懒加载与实例控制、主题读取、导出图片、useChartSurfaceRuntime
store/          会话级阅读状态（Pinia，只同步持有状态，不含规则，不持有 ECharts 实例）
ui/             薄 Vue：ChartSurface / ChartLegend / ChartReadingOptions / ChartDataTable
testing/        测试用固定数据（八类图表）
```

## 关键约定

- **按需加载**：ECharts（core + `SVGRenderer`）与四个图表家族（cartesian / scatter / share / radar）只在文档里出现图表并进入可见/预热区域时 `import()`；
  家族注册幂等，加载失败清除缓存允许重试。ECharts 实例只认识创建前已注册的家族，所以切换家族（如柱→饼）会重建实例。
- **主题**：色板按亮/暗选择，按实体在完整规格中的位置取色（固定顺序）；超过 8 个实体时不生成新色相，而是在同序色板上使用更浅的色调，靠图例和数据表识别。其余颜色读取 renderer-ui 语义 token；解析结果是不可变值，option 构建不触碰 DOM。
  显式 `color` 保持作者含义，不随主题偷偷换色。
- **确定性版面**：绘图区只有三档高度（240/320/420 px），标题与说明是 DOM 自然排版；加载、离屏占位与最终图之间没有版面跳动。
- **阅读不改变数据语义**：数值轴域、百分比堆叠的分母与颜色都按完整规格计算；隐藏系列或聚焦范围不重新拟合坐标轴、不重新分配颜色。
  饼/环只能突出，不隐藏组成部分，也不重算分母。
- **阅读状态**：按 Editor 会话 × 块身份 × 展示用途（`document` / `proposed` / `baseline`）隔离；规格语义变化（数据/类型/轴语义）时重置，主题、宽度、`size` 变化保留有效状态。
  状态同时保存规格语义键，重新挂载也核对离屏期间的数据变化。关闭文档（会话清理）与删除块（`ChartBlock` 的 `onTransaction`）时释放。
- **过渡**：只在同一已挂载图表里、类型与坐标语义不变且系列/观测对象可以由内容确认对应时，对合法数据更新或读者主动操作播放短过渡；身份来自系列名、类目键或唯一 `pointLabels`，
  身份键也写入 ECharts 数据项，关闭用户系统“减少动态效果”才允许过渡；展示属性变化完全替换 option，避免旧样式残留。从不按数组下标猜测。首次加载、主题/语言/容器变化、再入屏、编辑预览、Pending 对照和导出一律直接显示最终结果。
- **安全**：规格是纯数据；tooltip 的文本一律以 `textContent` 写入，字体族中的双引号规整为单引号（否则 SVG 不是合法 XML）。
- **复制为图片**：始终使用默认视图（不带筛选、聚焦与悬停），关闭动画并等待最终布局；失败单独报告。
- **数据表**：完整规格，不随筛选删行，可复制为 TSV；它也是低对比色的可靠读数通道。

## 验证

```bash
pnpm exec vitest run apps/renderer/domains/editor/features/chart-reading
```

`buildChartOption.test.ts` 用真实 ECharts SSR 渲染八类图表并在任何 ECharts 日志（warn/error）时失败；`chartInstanceController.test.ts` 覆盖实例创建、家族切换、释放与泄漏。
视觉质量（排版、配色、亮暗主题、真实 NodeView 交互）不能由这些测试证明，需要在真实应用里用样张和整篇文章验收。

研究数据保真：饼图扇区不设置最小角度；未指定数字格式时保留数值有效精度；单侧显式轴界限之外的数据产生有效自动域。
