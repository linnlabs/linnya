# Slides quality finding contract

本目录拥有 Slides 质量问题的正式内部合同。quality 规则先产生可复算事实，再由 inspection 补齐节点与源码身份，最终必须通过 `DiagnosticFindingSchema`；Agent 与 CLI 只能投影已接纳的 finding，不能从自由文案反推事实。

## 公共结构

`DiagnosticFinding` 只包含问题身份、级别、受影响页、严格 evidence、源码引用、可选根因键和修复验证合同。它不包含自由 `message`、`suggestion` 或任意 metadata。

- `DiagnosticNodeRef` 只保留节点 id、kind、单行 label、最终 box、z-index 和 parent id。
- `DiagnosticSourceRef` 只表示作者应修改的一个 `deck.js` 位置，并严格区分 `direct_creation / shared_creation / slide / unavailable`。`shared_creation` 表示同一范围在完整快照中创建多个最终节点；没有源码时必须说明原因，不能伪造行号，也不并列返回工厂位置与调用位置。
- remediation 只表达 `fix / review / informational`、目标节点和 `inspect / render` 复验方式。自然语言行动由 inspection 投影。
- scope 与 category 不写入 finding，由 code registry 唯一派生。

## 行动优先级

`P0 / P1 / P2` 是 inspection 对既有事实的派生顺序，不是 `DiagnosticFinding` 的新字段，也不替代
`severity / confidence / remediation`：

| 优先级 | 派生条件 | Agent 动作 |
| --- | --- | --- |
| P0 | `warning + high confidence + fix` | 先修确定性布局、文本、字体不可用等问题，再复验 |
| P1 | 其他 `warning` 中需要修复，或 high-confidence fidelity 复核项 | 先核对证据与 render，再决定修改 |
| P2 | 其余设计意图、审美与低风险提示 | 结合最终像素判断，不机械清零 |

唯一派生函数是 `classifyDiagnosticPriority()`。CLI 可以序列化该派生值方便筛选，Agent observation
按它排序；quality producer 不写 priority，Renderer 也不自行重算。

## Evidence families

| family | 必须回答的问题 |
| --- | --- |
| `node_bounds / node_size` | 哪个节点、最终几何、阈值与违反方向 |
| `node_overlap / origin_stacking` | 哪些节点、相交或共同锚点、设计意图证据；`text_decoration_collision` 的相交区域来自细装饰形状与最终文字行占位，而不是整个文本框 |
| `constraint_delta / parent_overflow` | 哪个父约束、声明值与最终值、直接后果 |
| `text_layout` | 最终或估算断行、内容尺寸与溢出事实；表格内另给 `rows[row][column]`，自动断行末行孤字另给 paragraph 和 orphan text |
| `scalar_metric / margin_balance / visual_anchor` | 页级指标、样本、阈值和比较方向 |
| `font_inventory / font_resolution` | 字体解析清单或明确替换事实 |
| `color_palette / hue_drift / color_contrast` | 色彩样本、跨页漂移或对比度推断 |
| `image_aspect / chart_readability` | 图片比例，或图表身份通道与标签物理容量 |
| `slide_similarity / content_presence / text_pattern` | 对应的窄业务测量与候选对象 |

逐 code 的 scope、category、evidence family、允许级别和复验策略以 [`diagnosticFindingRegistry.ts`](./diagnosticFindingRegistry.ts) 为唯一真值源。阈值仍归各 lint rule，不应搬进 registry。

## 新规则准入

新增 code 必须同时完成：注册唯一 policy、绑定严格 evidence、提供生产 fixture、证明 runtime admission 拒绝错配，并在 inspection 与 CLI 投影中穷尽接入。新增 remediation policy 还必须验证派生 priority 是否符合行动顺序。若现有 evidence 无法准确表达事实，应先扩展正式合同；禁止先上线 message-only warning。

上游证据来源与限制见 [`../README.md`](../README.md)。模型可见的低 token 投影见 [`../../../features/presentationInspection/README.md`](../../../features/presentationInspection/README.md)，完整机器报告见 [`../../../features/presentationCli/README.md`](../../../features/presentationCli/README.md)。

生成内容可显式声明 `background / decoration`，空间规则共用角色判定；越界仍保留 evidence，但该角色降为 info，节点 bleed 范围内不报告越界。文字后方 opacity ≤ 0.15 的细线及相交比例低于 5% 的细线不按确定遮挡报告。页脚/来源/页码不参与正文字体层级统计；纯符号的补字字体不增加正文 family 数量，替换和未解析事实仍可观察。CLI finding 外包络的 `action` 复用 inspection 处置目录，不扩展本层 strict schema。
