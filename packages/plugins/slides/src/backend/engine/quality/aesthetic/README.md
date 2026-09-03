# `quality/aesthetic/` —— AestheticLint 子模块

> 上层入口：[`../AestheticLint.ts`](../AestheticLint.ts)（薄编排，<120 行）。
> 包级边界与测试入口见 [`../../../../../README.md`](../../../../../README.md)。

`AestheticLint` 在 LayoutLint 之上叠加"审美维度"检查（包含字体族替换与实际 face 样式核对、既有 Tier-1 规则、重复检测与可复算指标）。
本目录把历史上的单体类按职责拆成高内聚子模块，主类只剩调度与 re-export。

```
quality/AestheticLint.ts        ← 薄编排 + 类型 re-export
quality/aesthetic/
├── types.ts                    ← codes / issues / report / metrics
├── thresholds.ts               ← 所有阈值常量（单一真源）
├── elementUtils.ts             ← findContainingShape / abbreviateLabel / clusterByGranularity / r3
├── colorSampling.ts            ← samplePageChromaticColors / pickPrimaryHue
├── chartReadability.ts         ← 图表身份与标签容量规则（纯函数）
├── lintRules.ts                ← 通用 lint 规则（纯函数）
├── repetition.ts               ← analyzeSlideRepetition + computeLongestRun
└── metrics.ts                  ← computeMetrics
```

## 模块边界（单一职责）

| 模块 | 职责 | 不允许 |
|------|------|--------|
| `types.ts` | 类型契约：`AestheticLintCode` / `AestheticLintIssue` / `AestheticLintReport` / `AestheticLintMetrics` / `SlideRepetitionPair` | 任何业务逻辑 / 阈值常量 |
| `thresholds.ts` | 所有 lint 用到的阈值常量（带单位 + 经验来源 + 调高/调低影响注释） | 任何函数 / 类 |
| `elementUtils.ts` | 与"元素几何 / 文本"相关的纯工具：`findContainingShape` / `abbreviateLabel` / `clusterByGranularity` / `r3` | 任何 lint code 判定逻辑 |
| `colorSampling.ts` | 把 slide 元素采样成 `ChromaticSample[]` + 提取主色 hue | lint issue 生成 |
| `chartReadability.ts` | 从最终图例、轴和标签事实判断身份缺失与明显容量不足 | 标题语义猜测、完整 series data、I/O |
| `lintRules.ts` | 通用规则纯函数：`(slideNumber, [slideSize], elements) → AestheticLintIssue[]`，或 deck-level `(info / aggregated) → ...` | 跨规则状态共享、I/O |
| `repetition.ts` | 相邻页结构 + 文本指纹比对，输出 `slide_repetition` issues + `SlideRepetitionPair[]` | 综合评分 |
| `metrics.ts` | `computeMetrics`：统计规则命中和相邻页相似度，不生成主观总分 | 新增 lint 规则 |

## 加新 lint 规则的 checklist

1. **加 code**：在 `types.ts` 的 `AestheticLintCode` union 里加一项，写明 Tier、判定条件与误判风险（参考既有注释格式）。
2. **加阈值**：如果引入"魔法数字"，去 `thresholds.ts` 加 `export const`，**带单位 + 经验来源 + 调高/调低影响注释**——禁止裸数字。
3. **写规则**：通用规则在 `lintRules.ts` 加一个 `lintXxx` 纯函数；同一窄业务事实产生的一组规则可放独立模块，禁止把文件机械拆成散乱 helper。
4. **挂主流程**：在 `../AestheticLint.ts` 的 `lint()` 中按"page-level → deck-level → repetition → metrics"的顺序挂上。
5. **加测试**：在 `packages/plugins/slides/src/backend/__tests__/aesthetic-lint.test.ts` 加边界 case（最小输入 / 阈值临界 / full-bleed 豁免等），测试直接 import 所属 engine 模块。

## 设计纪律

- **规则之间不共享状态**：唯一例外是 `samplePageChromaticColors` 的结果，由主类计算一次后同时传给 `lintPaletteDiversity` 和 `pickPrimaryHue`，避免重复采样。
- **规则不回调主类的方法**：所有依赖（`abbreviateLabel`、`clusterByGranularity`、阈值）通过 `import` 拿到。
- **不生成综合分**：不同规则维度不可加权成可靠的设计质量结论；消费者读取具体 code、evidence 与 metrics。
- **不重新解析字体**：run 级字体规则只读取上游平台字体服务写入的 requested/resolved family、script、resolution 与真实 face 样式。Latin/CJK 分开统计；family substitution、unresolved 与 style substitution 分开提示；缺少正式解析事实时宁可跳过，不用元素级回退字符串猜。
- **不引入页面背景色**：`lintTextContrast` 故意只判断"包含该文本的最小 shape fill"，避免误用全局背景色，因为 lint 不持有页面背景。如未来要扩展，请显式从 PresentationInfo 中读 deck/slide bg，不要回到 lint 内部猜。

## 关联模块

- [`../HeuristicLint.ts`](../HeuristicLint.ts)：Tier-2 启发式（probable-title / data-page-source / paragraph-too-long / title-question），独立类，输出复用 `AestheticLintIssue`。
- `packages/plugins/slides/src/backend/tools/inspectFeedback/diagnostics.ts`：把 issue 渲染给 AI / 用户，并通过包内相对模块消费本模块。
