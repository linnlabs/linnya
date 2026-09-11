# Slides Shared Text Layout

`shared/textLayout` 是 Slides 文本布局的领域规则层。它统一文字 cluster 与公式 atomic inline box 的软换行、段落布局、baseline、autofit 和 overflow，产出 backend 与 renderer 共同消费的最终行级 IR。

本模块不接触 PPTX、Konva、DOM、数据库、字体目录或测量服务。外部字宽和字体指标只能通过窄 provider 传入。

## 文档树

```text
shared/textLayout/
├── definitions/
│   ├── contract.ts                  # 文本框布局合同与默认 padding/wrap/autofit
│   ├── lineSpacing.ts               # 可辨识行距合同、默认值与 legacy admission
│   ├── provenance.ts                # advance/font/字距/overflow 的安全摘要合同
│   └── types.ts                     # provider、行级 IR 与布局结果
├── functions/
│   ├── segmentClusters.ts           # grapheme、强制换行、CJK break/kinsoku
│   ├── breakLines.ts                # cluster -> BrokenLine[] 的唯一断行规则
│   ├── layoutParagraph.ts           # 段落缩进、对齐、bullet 与 spacing
│   ├── lineMetrics.ts               # 行步进、公共 baseline 与 run 的 textY
│   ├── applyEllipsisOverflow.ts     # 确定性省略号与 overflow 事实
│   ├── resizeTextBoxForAutoFit.ts   # resize-shape 的锚点感知外框几何
│   ├── summarizeTextLayoutProvenance.ts # 页级紧凑归因摘要
│   └── resolveTextLayoutContract.ts # RenderModel 输入 -> 布局合同
└── orchestration/
    └── layoutTextNode.ts            # autofit、纵向对齐和最终结果编排
```

## 唯一数据流

```text
TextRenderNode / table cell
  -> resolveTextLayoutContract()
  -> backend 预热全部 cluster / ellipsis / shrink 档位
  -> layoutTextNode()
       -> layoutParagraph()
       -> measureLineMetrics()
       -> applyEllipsisOverflow()
       -> shrink / verticalAlign / resize-shape 所需高度计算
  -> TextLayoutResult
  -> resizeTextBoxForAutoFit()        # 仅 resize-shape；按垂直锚点落地外框几何
  -> finalized RenderModel
  -> renderer 逐 slice 绘制
```

`TextLayoutResult` 是最终布局事实，包含：

- `lines[].slices[]`：文字 slice 携带正文与 `textY`；公式 inline-box slice 携带投影 identity、`boxY` 和原子宽高；两者共享段落、run、`x` 与 `width`；
- `lines[].height/baseline`：行框与公共 baseline；
- `overflow.horizontal/vertical/hiddenLineCount`：布局阶段已经判定的溢出事实；
- `appliedFontScale`、`requiredHeightInches` 与 advance 来源。

renderer 不得再次测量、换行、autofit 或追加省略号。普通文本、shape inner text 和 table cell 都必须在 backend finalization 阶段得到同一种 `TextLayoutResult`。

## 行距合同

内部只允许以下可辨识类型：

```text
{ kind: 'multiple', value: number }
{ kind: 'exactPt', value: number }
```

- generated 未声明行距时固定为 `multiple: 1`，与 PowerPoint 单倍行距一致。
- `multiple` 的行步进是“当前 run 字号 × 倍数”；混合字号取本行最大步进。
- `exactPt` 的行步进是固定 pt，不再乘字体 OS/2 行框。
- 字体 ascent/descent 只决定公共 baseline 和各 run 的 `textY`，不能反向放大声明行距。
- 数字 `<= 4` / `> 4` 的历史判定只允许出现在 `definitions/lineSpacing.ts` 的 admission；持久化和布局主链不得重复猜测。
- 导入 PPTX 时，`spcPct` 映射 `multiple`，`spcPts` 映射 `exactPt`；未能取得 layout/master 上下文时必须标记 `unresolved`，不能把首段行距广播给其他段落。

## 断行、Autofit 与 Overflow

- deck.js 是否存在横向约束由 codegen/Flex compiler 在进入 DeckSpec 前判定并物化为显式 `box + wrap`：固定宽度使用 `word`，无横向约束的绝对定位 Text 使用固有宽度和 `none`。shared 不读取 authoring 字段，也不建立第二套判定。
- `segmentClusters.ts` 保留软换行符为 `isForcedBreak` cluster；`breakLines.ts` 对所有 wrap policy 都执行强制换行。
- `layoutTextNode.ts` 统一计算字号 shrink、纵向行位置与 resize-shape 所需高度；`resizeTextBoxForAutoFit.ts` 统一把所需高度物化为最终外框。resize-shape 最终扩展外框后，不保留旧高度造成的假纵向 overflow。
- resize-shape 增高必须保留 `verticalAlign` 表达的垂直锚点：`top` 固定上边缘，`middle` 固定垂直中心，`bottom` 固定下边缘。外框几何统一通过 `resizeTextBoxForAutoFit()` 计算，renderer 不得自行调整位置。
- `ellipsis` 在 shared 层真实改写最后可见行；renderer 的 `ellipsis` 开关必须关闭。
- 行内公式以不可拆分 atomic box 参与同一断行器。它提供 advance/ascent/descent/ink bounds，但不拥有第二套换行：宽于内容区返回 `slides.formula.inline_formula_too_wide`，`exactPt` 无法容纳时返回 `slides.formula.inline_formula_line_height_insufficient`，ellipsis 只能整颗移除公式。
- `clip` 保留完整行级 IR 和 overflow 事实，由 renderer 在文本框外边界裁剪；padding 只决定断行与文字起点。单个字形宽于内容区时，居中/右对齐允许产生负 `slice.x`，使字形进入 padding，这与 PowerPoint 的极窄标签行为一致。
- `visible` 不裁剪。

## Provider 约定

`RunAdvanceProvider` 返回与输入 clusters 一一对应的 advance；长度不一致属于合同错误，必须失败。`FontMetricsProvider` 只返回 ascent/descent/lineGap，不泄漏字体目录和平台实现。

强制换行（LF / CRLF）保留在断行序列中，但 advance 为 0，不送入 provider。预热、测量及返回数量校验都以排除换行符后的 clusters 为准；还原字宽时，换行符不消耗测量结果。此规则同样适用于一个 run 内混合文字和换行、连续空行及表格单元格，不能通过删除源换行来规避度量错误。

shared 算法是同步的。异步初始化、预热、缓存、字体解析和日志属于 backend 调用方。所有生产布局必须先预热，禁止 cache miss 后在 renderer 静默换一套测量算法。

`summarizeSlideTextLayoutProvenance()` 是 `ppt_inspect` 场景图的文本布局观察合同：聚合全部布局节点的 advance 来源与字体 identity，只展开存在字距、overflow、字体族替换、未决字体或请求/解析 face 样式不一致的节点。它可以公开字体文件内容 + face 身份的 SHA-256 以及 requested/resolved 字重和斜体事实，但禁止记录字体绝对路径或复制整段正文。

## 维护规则

- 新行距或行框语义先改 `definitions/` 和纯函数，再接 mapper、compiler、renderer。
- 新断行规则只改 `segmentClusters.ts` / `breakLines.ts`。
- 新 overflow 行为只改 shared finalization；不要在 Konva/PPTX 两端分别实现。
- 新 table text 能力复用 `TextLayoutResult`，不能在 table builder 内测量。
- shared 禁止 import backend、renderer、PptxGenJS、Konva、DOM、Node fs 或数据库。

## 测试入口

- 合同与行距：`src/shared/textLayout/__tests__/{textLayoutContract,lineMetrics}.test.ts`
- cluster 与断行：`src/shared/textLayout/__tests__/{segmentClusters,breakLines,lineBreakRegression}.test.ts`
- 布局、autofit、overflow：`src/shared/textLayout/__tests__/{layoutTextNode,resizeTextBoxForAutoFit}.test.ts`
- 观察合同：`src/shared/textLayout/__tests__/summarizeTextLayoutProvenance.test.ts`
- backend finalization：`src/backend/engine/text/__tests__/renderModelTextLayout.test.ts`
- 多行表格的真实预热、布局、Inspect 场景图、前端绘制投影与 PPTX 导出：`src/backend/__tests__/table-forced-break.integration.test.ts`
- renderer fail-closed：`src/renderer/features/konvaPreview/functions/builders/__tests__/{textBuilder,tableBuilder}.test.ts`

无横向约束的生成文本在 Backend 落库前由 `engine/text/materializeIntrinsicTextBoxes` 调用本模块同源排版，以最终行宽和默认 inset 得到盒宽；宽度向上量化到 OOXML EMU。左右默认 inset 各 0.1in、上下各 0.05in，诊断 evidence 使用相同口径。编译证据保留 `intrinsicTextAdvanceSource`，不得把 heuristic 标成 HarfBuzz。
