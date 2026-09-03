# Generated Layout Constraints

`generatedLayoutConstraints` 定义 Flex/Yoga 编译后跨 DeckSpec、RenderModel 与 quality
传递的窄布局事实。它只服务 generated Slides 的诊断，不是 deck.js 可写语法，Renderer
也不据此改变绘制。

权威来源是 Flex compiler 同时持有的 `LayoutResult.node + box`。允许传递的内容只有：

- flow / absolute 定位模式；
- 作者显式写下的数值宽高、min/max 与四边约束；
- Yoga 最终盒和可比较尺寸的 `final / declared` 比例；
- 直接 computed 父容器的稳定身份、最终盒、source span，以及父容器自身的窄约束事实；
- 当前 DSL 的可见 overflow 语义。

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
拥有；本目录只拥有事实合同。
