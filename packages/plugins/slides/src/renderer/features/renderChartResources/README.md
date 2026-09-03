# Render Chart Resources

`renderer/features/renderChartResources` 是 Slides 图表栅格资源生命周期 feature。它负责递归发现可见
`ChartRenderNode`、按图表家族延迟加载 ECharts、生成并解码 PNG、跨主舞台与 renderer thumbnail 去重，
以及为 hidden worker 提供同一套严格资源入口。

本 feature 不决定图表在页面上的位置、旋转和透明度；这些组合属性仍由 `konvaPreview/chartBuilder` 映射。
Vue 图表组件只能消费已就绪资源，禁止在 mount/watch 中创建 ECharts 实例。

## 目录与职责

```text
renderChartResources/
├── definitions/                       # 已解码图表、target、稳定错误
├── functions/
│   ├── collectSlideChartResourceTargets.ts # 递归发现可见图表
│   ├── createChartResourceIdentity.ts      # 稳定签名与紧凑 cache key
│   ├── renderChartToImage.ts               # ECharts -> PNG -> decode
│   └── runtime/                            # core / cartesian / pie / radar 延迟注册
├── orchestration/
│   ├── renderChartResourceRegistry.ts      # in-flight 去重、LRU、消费方取消
│   └── loadSlideChartResources.ts          # 单页资源 map 与失败语义
└── index.ts
```

## 身份、缓存与取消

- PNG 身份包含尺寸、数据、palette、轴、图例、标签、网格线、stacking、PPTX hints 和 pixel ratio。
- `x/y/zIndex/rotation/opacity/id` 不改变 PNG，由 Konva 组合，因此移动图表不会触发重栅格。
- 注册表用紧凑哈希查找，再用完整稳定签名校验；碰撞不能返回另一张图表。
- 默认最多缓存 48 个已解码图表、约 128 MiB RGBA 体积，按 LRU 淘汰 settled 条目。
- `AbortSignal` 只取消当前页面消费者的等待与提交资格，不能终止其他消费者共享的渲染。

## 失败语义

- 交互主舞台使用 `failureMode: 'omit'`：失败节点以稳定透明占位显示，页面仍可切换。
- thumbnail / screenshot 使用 `failureMode: 'reject'`：任何图表失败都转成稳定 raster resource error，
  禁止静默导出缺图表的 PNG。
- 主舞台的图片与图表原子提交、快速切页和相邻页 idle 预热由
  [`renderVisualResources`](../renderVisualResources/README.md) 编排。

## 构建边界

ECharts 不允许从 renderer contribution 同步入口加载。runtime 先加载 core + CanvasRenderer，再按实际图表
类型加载 cartesian、pie 或 radar 家族；zrender 由生产构建按稳定第三方边界单独分块。增加图表类型时必须
同步 runtime 注册、mapper、资源测试和 500 kB 生产构建门禁。

## 测试入口

- 注册表去重、身份、取消、LRU、失败：`orchestration/renderChartResourceRegistry.test.ts`
- 图表 option 规则：`../konvaPreview/functions/echartsMapper.test.ts`
- 主舞台原子提交：`../renderVisualResources/orchestration/useReadySlideVisualResources.test.ts`
- raster 集成：`../slideRasterization/orchestration/renderSlideRaster.test.ts`
