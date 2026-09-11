# Chart compilation

本模块负责 generated Chart 的跨端控制和原生 PPTX 编译，不做页面自动布局、模板选择或图表数据推断。
返回 [engine 总览](../README.md)。

## 单一合同与边界

- 作者字段唯一类型是 [flexComposeContract](../../../shared/flexComposeContract.ts) 的 `LayoutChartControls`、
  `LayoutChartSeriesInput` 与 `LayoutChartStyle`；数据继续使用 categories/series，不引入 dataset/encode。
- [chartParsers](../../codegen/compose/inputParsers/chartParsers.ts) 负责字段族和组合准入：轴范围、系列长度、
  柱堆叠、显式次轴、标签内容与图表族的约束。Direct 和 Flex 使用同一校验，不能只靠类型检查接纳数值关系。
- 颜色沿用 shared visual colorContract；数字格式的准入与 ECharts 文本输出共用
  [shared/chart/numberFormat](../../../shared/chart/numberFormat.ts)，不支持完整 Excel 日期/科学计数/条件格式语言。
- 作者字段表、单位、限制见 [Skill Chart 合同](../../../../resources/skills/slides-design/references/syntax.md#9-chart)，
  可执行原子示例见 [chart-controls.js](../../../../resources/skills/slides-design/references/examples/chart-controls.js)。
  d.ts 由 codegen 生成，不手改。

## 职责

| 文件 | 职责 |
|---|---|
| `chartOptions.ts` | 预设/内部 options → 公开语义覆盖。导出与 generated RenderModel 共用；无预设时字号沿用 shared 默认，显式字号优先 |
| `chartPptx.ts` | 以“图表族 + 主/次轴”分组，写原生图表及内嵌工作簿，收集 marker 和逐系列物化计划 |
| `applyChartPptxStyles.ts` | sanitizer 阶段通过 slide marker → relationship → chart part，写系列样式、单点颜色、标签和顺序 |

同类型同轴的系列保持一个 chart group，否则簇状柱、堆叠和图例语义会改变。组合图不按“折线=右轴”推断，
右轴必须显式声明，且不能继承左轴单位/范围/标题。系列重排只用于原生 group，`c:order` 保留作者顺序。

PptxGenJS 4.0.1 的 multi API 第二参数必须留空，options 在第三参数；空数组会吞掉 options。
仓库现有 pnpm patch 补了这个实际存在的类型重载，没有更改 SDK 图表运行时或绕过 TypeScript。

细粒度样式只补 SDK 无法表达的 `c:ser` / `c:dPt` / `c:dLbls`，不重建图表或数据工作簿。
marker 和 series 索引必须唯一命中，否则编译失败，不能输出缺少承诺样式的成功产物。
饼/环逐点标签会覆盖系列标签，覆盖时必须同时更新两层；新增 XML 子节点遵守 OOXML 顺序。
图表的 patch plan 与已有 Paint、Formula 计划共同由 sanitizer 编排，不引入通用 OOXML 插件框架。

## 预览与承诺

generated RenderModel 直接来自 DeckSpec，经 ECharts 绘图；轴、标签、series 样式和数据共用事实。
百分比堆叠只改变柱高，标签仍为原值；饼/环 percentage 标签先计算占比，百分号格式再负责显示。
字体、字号、绘图区底色、线宽等所有像素属性进入 [图表资源缓存身份](../../../renderer/features/renderChartResources/README.md)。

默认 PPTX 保留原生 chart 与可编辑数据，不改成 SVG/形状或图片；用户选择图表转图片时继续走既有导出链。
ECharts 与 Office 的排版不保证像素级一致。`PptxReader` 当前只识别 imported chart 容器，
本次不新增外部图表的完整数据/轴回读能力，不能把 generated 原生导出测试称作完整 import round-trip。

## 验证

- `backend/__tests__/codegenFirstExamples.test.ts`：真实 sandbox → DeckSpec → ECharts SVG 与 PPTX XML/工作簿；
  组合分组、右轴隔离、原始顺序、单点颜色、逐系列标签、百分比、无效组合。
- `backend/__tests__/render-model-mapping-chart-table.test.ts` 与 `renderer/.../echartsMapper.test.ts`：既有图表回归。
- 图表资源 registry 测试：编辑颜色/线宽/背景后重绘，移动时复用，不返回旧像素。
- 类型检查、生成 d.ts、Skill gate、Slides 全量测试和插件构建。实际 Office 字体/标签排版仍需 PowerPoint 人工验收。
