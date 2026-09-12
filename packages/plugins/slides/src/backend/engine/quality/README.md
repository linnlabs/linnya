# Slides Engine Quality

`engine/quality` 是 Slides 后端质量分析层，负责把 `PresentationInfo` 或由 render-model 派生的 lint 输入转成布局、审美、重复和空间关系证据。

正式诊断合同、code registry 与新规则准入要求由 [`definitions/README.md`](./definitions/README.md) 统一维护。quality 规则拥有阈值和判定，inspection/CLI 只消费通过 admission 的 finding，不得各自重建问题字段。

quality 模块不修改 deck、不修复布局、不写 PPTX。规则结果是供 Agent 或人工复核的 finding 原料，不代表设计好坏，也不能替代构建状态。只有源码、资产、编译、渲染或持久化导致文稿无法生成时，才由独立的 `PresentationBuildFailure` 表达错误。

## 文档树

```text
quality/
├── README.md                    # 本说明
├── definitions/                 # DiagnosticFinding、evidence 与 code registry
├── LayoutLint.ts                # 出页、重叠、文本溢出等布局风险检查
├── AestheticLint.ts             # 审美规则编排与 aesthetic 子模块 re-export
├── HeuristicLint.ts             # probable-title、data-page-source 等启发式检查
├── SpatialAnalyzer.ts           # 元素空间关系分析
├── SpatialSemantics.ts          # overlap / containment / decorative 等空间语义分类
├── SpatialTypes.ts              # 空间关系类型定义
├── RelationGraph.ts             # 元素关系图构建
├── colorUtils.ts                # 颜色计算纯规则
├── renderModelToLintInfo.ts     # PresentationRenderModel -> lint input
└── aesthetic/
    ├── README.md                # AestheticLint 子模块说明
    ├── types.ts                 # aesthetic issue/report/metrics 类型
    ├── thresholds.ts            # aesthetic 阈值常量
    ├── elementUtils.ts          # 元素几何/文本辅助纯规则
    ├── colorSampling.ts         # 页面色彩采样
    ├── chartReadability.ts      # 图表身份与标签容量规则
    ├── lintRules.ts             # aesthetic lint 规则
    ├── repetition.ts            # 相邻页结构与文本重复检测
    └── metrics.ts               # 可复算的规则命中与相邻页相似度指标
```

## 架构与数据流

```text
PresentationInfo 或 LintInfo
  -> LayoutLint
  -> AestheticLint
       -> aesthetic/lintRules
       -> aesthetic/chartReadability
       -> aesthetic/repetition
       -> aesthetic/metrics
  -> inspect feedback: buildStatus + findings
```

空间关系：

```text
Slide elements
  -> RelationGraph / SpatialAnalyzer
  -> SpatialSemantics 分类
  -> LayoutLint / inspect feedback 消费
```

RenderModel 输入：

```text
PresentationRenderModel
  -> renderModelToLintInfo()
  -> LayoutLint / AestheticLint
```

## 边界与依赖

- quality 可以依赖 `@plugin/slides/shared` 的 `PresentationInfo`、render-model DTO 和稳定纯规则。
- 文本测量或字体信息如需参与规则，必须通过平台 port 或上游已经计算好的 lint input，不在 quality 内部新建测量实现。
- 字体规则只消费 run 级 `fontFamily + resolvedFontFamily + fontScript + fontResolution`：按脚本分别统计，weight/style 不算新 family，unresolved 单独形成 finding；requested/resolved family 不一致时输出 `font_family_substituted`，请求样式与 `resolvedBold/resolvedItalic` 不一致时输出 `font_style_substituted`。这些规则都禁止在 quality 内重新解析字体或退回第一 run 的原始 family 字符串猜测。
- quality 不读取 PPTX zip，不访问 repository、workspace、IPC、renderer store。
- quality 输出 issue/report 供内部分析；`ppt_inspect` 与 Slides CLI 只投影 `buildStatus + findings`，不输出综合分、passed 或 blocker。
- generated 文本优先消费最终 `textLayout`：连续两位及以上数字若实际排成多行，`short_numeric_text_wrapped` 记录真实行数；非显式换行的段落若自动断行后末行只剩一个字素，`text_single_glyph_last_line` 记录段落与孤字。表格单元格不伪造 RenderNode，而是通过 table 节点上的窄 `tableInfo` 事实报告 `rows[row][column]`。这些规则只报告，不改文字、不重新测量、不强制不换行，也不替 Renderer 修正布局。
- generated 图表只消费 RenderModel 已解析的类别、系列、图例、坐标轴与数据标签事实：类别/系列没有可见身份通道时报告 `chart_identity_missing`；轴标签或环图外置标签所需跨度明显超过可用跨度时报告 `chart_label_capacity_exceeded`。两者均为 medium-confidence P1，必须结合 render 复核；规则不读取标题猜“价值桥/瀑布图”等作者意图，也不复制 series values。
- generated 约束规则只消费 compiler 提供的
  [`layoutConstraintEvidence`](../../../shared/generatedLayoutConstraints/README.md)：显式 flow 尺寸低于声明值
  80% 时报告 `layout_constraint_compressed`；absolute 内容越出非 slide computed 父盒超过 0.01 英寸时报告
  `descendant_outside_computed_parent`。纯装饰 shape 不参与后者；两条规则只诊断，不改变 Yoga 默认值。
- `findings` 的 severity 只有 `warning | info`，并携带置信度、设计意图上下文、节点/源码位置证据和 remediation。裁剪、越界、重叠都不得仅凭几何规则升级成构建错误。
- `P0 / P1 / P2` 不由 lint rule 生产，而由 inspection 根据 registry 中的 remediation 与 finding 的 severity/confidence 统一派生；规则不得硬编码 Agent 展示顺序。
- benchmark/harness 只记录可复算 metrics 与 finding 数量，不按视觉规则判定 pass/fail。PPTX 构建、解析和校验各自维持明确的技术验收合同。
- aesthetic 阈值集中在 `aesthetic/thresholds.ts`，规则里不要散落裸数字。

## 开发规范

- 新 layout 问题 code 放 `LayoutLint.ts` 对应类型和规则，并补最小业务 case。
- 新 aesthetic 规则先在 `aesthetic/types.ts` 定义 code，再在 `thresholds.ts` 放阈值。单条通用规则放 `lintRules.ts`；图表可读性这类内部共享同一事实与边界的规则族放独立高内聚模块，并由 `AestheticLint` 薄编排接入。
- 新空间关系语义优先放 `SpatialSemantics.ts`，避免多个 lint 规则各自判断 overlap 是否合理。当前分类会综合 containment、显式组件 parent、线—节点邻接、z-order、opacity、semanticRole 和面积比例；调用方必须传递已有事实，不能退化为只传 kind/box。只有非 slide 的共同 parent 且至少一方为 Shape 时才表示组件装饰关系；另一个明确例外是较低 z-order 的 Shape 完整承载 Chart，此时 Shape 是图表面板。反向层叠、部分覆盖、同页普通顶层元素和组件内的 text-text 重叠都不能因此互相豁免。
- `origin_stacking` 只聚合同锚点且无法由上述语义解释的独立内容；Group 与显式背景/装饰不参与。Shape path 的外盒可以是共用 viewBox，不能把已声明的装饰路径当成定位失败。细盒的装饰推断仅适用于 Shape，不能豁免小字号文字或窄表格。两个 Text 共用锚点不等于父子容器。
- 普通 `element_overlap` 仍是 medium-confidence 盒相交复核事实；例如表格压住页脚可有真实交集，但仅凭盒与 z-order 不足以证明具体字形被不透明内容遮住。它不因人工在某张图上确认遮挡而统一升级 high-confidence；规则优先级与最终可读性不能互相替代。
- 面积覆盖率等数学上有界的几何派生值必须在 `SpatialSemantics` 的生产端消除浮点越界，再进入 strict evidence schema；CLI 和 Agent 投影不得各自修正数值。
- 新规则不得增加综合评分或美学 passed 阈值；无法构建的事实进入 build-failure feature，视觉现象进入 findings。
- finding 文案应说明对象、证据、置信度、可能的设计意图和可行动线索，禁止使用“必须修复”描述启发式判断。

## 测试入口

- layout / aesthetic / heuristic：`packages/plugins/slides/src/backend/__tests__/{layout-lint,aesthetic-lint,heuristic-lint}.test.ts`
- spatial / color：`packages/plugins/slides/src/backend/__tests__/{color-utils,render-model-to-lint-info}.test.ts`
- inspect feedback：`packages/plugins/slides/src/backend/tools/inspectFeedback/**/*.test.ts`
- 插件全量：`pnpm run test:plugin:slides`

Shape/Image 的 `role: background | decoration` 经 compiled 元数据进入空间诊断：越界保留 info 证据，边距与装饰碰撞不再要求修正；`bleed` 是节点级非负英寸授权，仅超出授权才产生越界 finding。未声明角色的细线只有在低透明度、位于文字后方时才豁免碰撞，前景相交继续报告。Text 的 `footnote/source/page-number` 角色不参与正文字号档位和字体族数量统计。CLI finding 的 `action` 与 inspect observation 共用处置短语。
