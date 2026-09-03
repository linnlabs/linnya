# Render Visual Resources

`renderer/features/renderVisualResources` 是 Slides 页面视觉资源的 app-level orchestration。它不拥有图片、SVG Graphic 或
图表的具体加载规则，只负责并行调用 `renderImageResources` 与 `renderChartResources`，并把目标页模型、已解码图片/SVG
map、图表 map 作为一份完整视觉帧提交给主舞台。

## 切页合同

```text
currentSlideRender 变化
  -> 创建当前消费者 AbortController
  -> 并行准备图片/SVG + 图表
  -> 等待期间继续展示上一份完整视觉帧
  -> 两类资源全部成功或明确失败
  -> 一次替换 { slide, imageResources, chartResources }
  -> Konva 绘制完整新页面
  -> 浏览器 idle 时预热相邻页
```

快速 A → B → C 时，B 的消费者会失去提交资格；即使共享资源稍后完成，也不能覆盖 C。frame 使用单个
`shallowRef` 持有，公开的 slide / image / chart 都从同一个 frame 派生，禁止恢复三个独立 watch 或组件级
异步加载。

图片、图表失败在交互预览中是“已明确失败”的完成状态，对应节点显示占位，不应让页面永远停在上一页。
严格 raster 导出不走该宽松语义，而由同一 `loadSlideVisualResources` 使用 `failureMode: 'reject'`。
若资源编排本身发生非节点级故障，controller 必须暴露失败状态，由主舞台显示真实渲染错误；禁止把缺失的
视觉帧解释为“尚未选择页面”。

## 边界

- 编排层只控制加载顺序、取消、提交和预热；资源身份、缓存和失败规则留在各自 feature。
- DOM 图片对象不进入 Pinia store；store 只持有 deck、render model、thumbnail 和 UI 业务状态。
- 相邻页只在 idle 阶段预热，不在当前页面提交前抢占 ECharts 主线程工作。
- 不一次性预渲染整份 deck，避免解码内存和图表 CPU 随页数线性增长。

## 测试入口

- 原子视觉帧与快速切页：`orchestration/useReadySlideVisualResources.test.ts`
- 图片注册表：`../renderImageResources/orchestration/renderImageResourceRegistry.test.ts`
- 图表注册表：`../renderChartResources/orchestration/renderChartResourceRegistry.test.ts`
