# Fidelity Corpus Fixtures

这个目录存放 M5a 轻量文本布局保真语料。它不是完整视觉校准平台，只提供少量稳定 deck，方便后续 harness 反复检查 Slides 文本布局主链有没有退步。

当前三个 PPTX 由 Linnya 项目在 2026-07-07 的文本布局保真工作中生成，文件元数据中的生成器为
`Walnut Exporter`。它们只包含下述合成测试内容，不来自用户文档或第三方模板，可以随项目源码分发。

## Decks

- `layout-symbol-breaks.pptx`
  - 覆盖 `pass@1`、`£720`、URL / email、`wrap:none` 长 token。
  - 后续重点检查 token 边界、行数、每行首 cluster、内容高度与 `advanceSource`。
- `layout-mixed-runs-cjk.pptx`
  - 覆盖 mixed runs、CJK 标点避头尾、缺失字体 fallback、run slice 保留。
  - 后续重点检查 run slice 不被压扁、resolved font
    identity 可观测、CJK 标点不落行首。
- `layout-autofit-bullets-justify.pptx`
  - 覆盖 `shrinkText`、`resizeShapeToFitText`、justify 语义、多级 bullet。
  - 后续重点检查 autofit 合同、行高单源、justify 不丢语义、bullet 段落属性不被重解释。
  - 当前 `PptxReader` 还没有把 imported 段落 `algn`
    暴露到 inspect 结果；justify 先作为 OOXML 字段回归点检查。

## 维护规则

- 这个目录只放用于文本布局保真的 PPTX 输入语料；不要混入审美验收 deck 或历史 compatibility
  fixture。
- 不提交临时测试字体，也不提交 PowerPoint /
  LibreOffice 截图。完整跨渲染器校准属于 M5b。
- 新增 deck 前先写清楚它锁住的历史事故点；如果只是普通展示样例，不应放在这里。
- 后续 harness 应优先走 headless 路径，不要求每次打开前端。

## 当前护栏

- `packages/plugins/slides/src/backend/__tests__/fidelity-corpus.test.ts`
  - 校验每个 deck 能通过 `PptxValidator`。
  - 校验 `PptxReader` 能读到 slide 和命名 case。
  - 锁住 `wrap`、`autoFit`、缺失字体名、mixed run XML、justify `algn`
    和 bullet 字段。
  - 对 3 个 deck 跑 imported render-model +
    `applyTextLayoutToRenderModel`，锁住关键 case 的
    `layout.lines`、内容高度、`requiredHeightInches` 和 `advanceSource`。
  - 语料使用测试文件私有、字号感知的确定性 advance
    provider；不得读取或重置进程级
    `defaultTextMeasureService`，避免并行测试的 adapter 装配状态改变断点。
  - imported bullet case 同时锁住三个 OOXML paragraph 仍是三个
    `RenderParagraph`，禁止再次把段落压平后拼接。
