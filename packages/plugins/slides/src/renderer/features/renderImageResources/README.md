# Render Image Resources

`renderer/features/renderImageResources` 是 Slides renderer 的浏览器图片解码生命周期 feature。它负责从
RenderModel 收集页面图片和 admitted SVG Graphic data URI、解析最终 source、完成浏览器解码，并跨主舞台与离屏缩略图去重。

本 feature 不解释图片布局、fit、mask、border 或 shadow；这些视觉规则仍由 `konvaPreview` builders 拥有。
它也不把 DOM 图片对象放进 Pinia store。store 只保存 deck/render/thumbnail 业务状态，解码资源由 renderer
execution context 内的有界注册表持有。

## 目录与职责

```text
renderImageResources/
├── definitions/                    # 已解码图片、单页 target、稳定错误
├── functions/
│   └── collectSlideImageResourceTargets.ts
│                                      # 递归收集背景、普通图片与 SVG Graphic
├── orchestration/
│   ├── renderImageResourceRegistry.ts # in-flight 去重、decode、LRU 与消费方取消
│   └── loadSlideImageResources.ts     # 单页资源 map 编排
└── index.ts                         # feature 公共入口
```

页面模型、图片和图表的原子提交属于跨资源流程，由
[`renderVisualResources`](../renderVisualResources/README.md) 统一编排；本 feature 不保存第二套切页状态。

## 缓存与身份

- `renderAssetSource` 负责本地文件物化和最终 source 的紧凑摘要；Data URI 本体禁止作为 vnode key、watch key
  或日志字段。
- SVG Graphic 的业务类型和 fit 规则属于 `svgGraphicRendering`；本 feature 只复用同一浏览器
  `Image` 解码与缓存机制，不把 SVG 重新归类为普通 Image。
- 注册表以紧凑摘要查找，并以完整最终 source 二次比较。摘要碰撞只损失一次缓存命中，不能返回错误图片。
- 同一 renderer execution context 的主舞台和 thumbnail raster 共用注册表；hidden worker 在自己的隔离上下文
  内拥有独立实例。
- 默认最多持有 64 个已解码条目、约 128 MiB RGBA 解码体积。LRU 淘汰只释放注册表引用，不会破坏当前画布
  已持有的图片。
- 相邻页面预热策略由 `renderVisualResources` 决定；本 feature 只提供可复用加载能力。

## 边界

- 允许依赖 renderer `services/renderAssetSource` 和诊断日志。
- `konvaPreview` 可以消费 `LoadedRenderImage`，但不能重新创建 `Image` 或发起异步 IO。
- `slideRasterization` 必须通过 `loadSlideVisualResources` 间接获取图片，不能维护第二套 preloader。
- 共享 decode 不能因单个页面的 `AbortSignal` 被取消；取消只阻止已过时的页面提交。
- 新增图片来源身份规则时，必须同步 source key 测试、注册表碰撞校验和本地文件失效测试。

## 测试入口

- 注册表去重、取消与 LRU：`orchestration/renderImageResourceRegistry.test.ts`
- 页面原子提交与快速切换：`../renderVisualResources/orchestration/useReadySlideVisualResources.test.ts`
- source 身份和本地文件失效：`../../services/renderAssetSource.test.ts`
- 主舞台/缩略图共用路径：`../slideRasterization/orchestration/renderSlideRaster.test.ts`
