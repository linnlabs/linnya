# 图表共享布局

本模块拥有 generated 普通柱、条、折线和有限标签饼/环的 inner plot 与图例占位规则。
Backend 的 [布局适配器](../../backend/engine/chart/resolveGeneratedChartLayout.ts) 将最终图表选项
投影为同一输入；RenderModel 与原生 PPTX 编译分别消费解析结果，Renderer 不重新求解布局。

## 合同与单位

- 输入尺寸和轴标题距离使用 inches；字号使用 pt。
- `ResolvedChartLayout.plot` 和 `legend.box` 的 x/y/w/h 是相对于整个图表外框的 0–1 比例。
  plot 是不含轴标签的绘图区，对应 OOXML `layoutTarget=inner`。
- 图例按实际文本占位及字号排列为行或列，预览使用明确的换行边界；PPTX 保留原生图例，
  写入相同外框的 manualLayout。x/y 使用 edge，w/h 使用 factor，避免宽高被解释为右/下边界。
- 复用 portable 文本测量，与生成表格一样是确定性字宽估算，不是系统字体或 Office 字形实测。
  原生图例在指定外框内仍由 PowerPoint 排字，字体替换或内部间距差异可能改变换行。
- 自动刻度只参与标签占位估算，解析结果不包含轴范围或步长。只有作者显式提供的
  min/max/majorUnit 才进入 PPTX；PowerPoint 修改数据后继续自动适应数值轴。

## 支持边界

普通柱、条、折线使用共享绘图区，预留类目标签旋转后的空间、数值标签和轴标题空间。
横向条形的类目标签额外保留半行高的字形外延空间，防止 portable 字宽低估导致首字被画布裁掉；
水平值轴两端各为居中的刻度文字预留半个文本宽度，左侧与类目占位取较大值。留位只由文本和字号
计算，预览 grid 与原生 inner manualLayout 消费同一结果，不用 Office 截图的坐标作为单侧补偿。
饼/环最多 8 个类别时使用共享圆形绘图区，并为外部数据标签留位；更多类别、组合图、面积、
雷达和散点仍使用既有引擎自动布局，不承诺这组共享几何。极小图表无法容纳完整标签或图例时
明确报告空间不足，不能缩字或静默裁掉图例。

两端的默认刻度算法和饼图标签避让算法仍不同；显式轴控制可以提高静态一致性，但会固定
PowerPoint 后续的数据范围，因此不能由布局器自动补写。字体、标签碰撞和 Office 实际效果
仍需原生 PowerPoint 验收。

## 入口与验证

- `definitions/chartLayout.ts`：归一化几何合同和严格 schema，RenderModel codec 与 worker 共用。
- `functions/resolveChartLayout.ts`：文本占位、图例行列、轴标题留位与 plot 计算。
- `backend/__tests__/chart-layout.integration.test.ts`：DeckSpec → RenderModel/ECharts SVG 与
  PPTX XML，覆盖四侧图例、横纵柱、折线、饼环、显式轴控制、紧凑轴标题和多行图例。
- 图表布局进入资源缓存身份，布局变化必须重绘；位置移动继续复用缓存。
