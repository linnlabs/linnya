# Generated Layout Constraints

`generatedLayoutConstraints` 定义 Flex/Yoga 编译后跨 DeckSpec、RenderModel 与 quality
传递的窄布局事实。它服务 generated Slides 的诊断与已证明等价的人工编辑投影，不是
deck.js 可写语法。Renderer 只通过共享纯函数判定独立盒几何，不能据此重建作者布局树。

需要带动兄弟节点的 flow 宽度编辑，使用独立的
[generatedLayoutReplay](../generatedLayoutReplay/README.md) 页面编译快照，不扩张本诊断合同。

权威来源是 Flex compiler 同时持有的 `LayoutResult.node + box`。允许传递的内容只有：

- flow / absolute 定位模式；
- 作者显式写下的数值宽高、min/max 与四边约束；
- Yoga 最终盒和可比较尺寸的 `final / declared` 比例；
- 直接 computed 父容器的稳定身份、最终盒、source span，以及父容器自身的窄约束事实；
- 当前 DSL 的可见 overflow 语义；
- 自动高度 Text 实际使用 portable heuristic 时的字号、行距、字距输入；不复制正文。

禁止把完整 LayoutNode、children、样式对象、文本全文或源码复制进该合同。imported PPTX
没有 Yoga 声明事实时字段保持缺省；quality 不得从最终 RenderModel 反推作者原值。

跨 Worker、持久化和 RenderModel 的读取统一使用本目录的合同守卫。新增字段必须先更新定义与守卫；消费端不能各自复制一份宽松校验，也不能把该内部事实开放为 deck.js 输入。

数据流：

```text
Flex compiler
  -> DirectElementInput（内部 tracking）
  -> DeckSpec（内部 tracking）
  -> RenderNode.layoutConstraintEvidence
  -> PresentationInfo / quality finding
```

判定阈值和问题 code 由 [`backend/engine/quality`](../../backend/engine/quality/README.md)
拥有；本目录拥有事实合同及其可重放的纯几何规则。

`computeGeneratedLayoutRatios` 是编译器与已证明等价的人工尺寸投影共用的比例规则。输入使用舍入前的最终尺寸，与作者声明相比后才量化；不能从已经四舍五入的 finalBox 反算。Frame 位移投影同步后代的父/祖父容器位置，但保持声明与尺寸比例不变。

`projectIndependentTextWidth` 供 Backend 与 Renderer 共用：有明确左边、宽度且不含宽度 min/max 的绝对定位 Text 可保持固定高度；自动高度还须有明确顶边、无底边约束以及同源测量输入。`measureGeneratedTextHeight` 复用 portable text-measurement-core 的已有算法，重放 Yoga float32 点数输入与高度下／上限，再按编译器格点舍入。它只计算 Yoga 输入盒，最终 glyph shaping、换行和 autofit 仍由 shared/textLayout 拥有。定制测量 adapter 不产出可重放标记；旧快照没有该标记时不猜测，完整编译后补齐。
