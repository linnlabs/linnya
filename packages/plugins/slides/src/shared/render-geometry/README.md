# Render Geometry Shared Contract

这里放 Slides
render-model 的跨端几何契约，供后端几何快照测试和 renderer 预览共同消费。

- `chartGeometry.ts`：图表 frame、gutter、range、坐标映射、像素吸附等纯计算。
- `textGeometry.ts`：只定义跨端文本测量请求、结果与 `RenderTextMeasurePort`
  窄合同，不计算换行或 autofit。正式文本布局由
  [`../textLayout/`](../textLayout/) 拥有，backend 通过 `LineLayoutEngine`
  生成最终逐行结果。
- `imageGeometry.ts`：图片和 SVG Graphic 的 `cover` / `contain` / `stretch` 的
  归一化 source 与 destination 几何。renderer 将它换算为像素裁剪，PPTX
  adapter 将它换算为图片盒和 OOXML `srcRect`；两端不得各自重新实现比例计算。

边界要求：

- 只能依赖包内纯类型/纯函数契约；render-model 类型必须从 `../renderModel`
  这个包内权威合同进入，不能在几何子模块里散落直连 host schemas。
- 不能 import Vue、Konva、renderer domain、DOM、`window`、`document` 或
  `BrowserPretextAdapter`。
- renderer 不得通过该目录重新测量、换行或缩放文本；Konva 只消费 backend 已完成的 text
  layout。
- 仍使用 `RenderTextMeasurePort`
  的旧调用方只能把它当跨端测量 DTO；新增正式布局能力必须进入 `shared/textLayout`
  与 backend text engine，不能在这里恢复第二套 solver。
