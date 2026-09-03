# Test Fixtures

`__tests__/fixtures/` 分为三类：

## `golden-regression/`

确定性的生成、解析、patch 与兼容回归真值源，由 `golden-regression.test.ts`
和 engine Harness 消费。允许保留手写显式布局，但不承担 Agent 审美 Benchmark。

## 根目录 `*.pptx`

reader、import、template 与 patch 的原始 OOXML 夹具，例如
`simple.pptx`、`themed.pptx`、`with-chart.pptx`。它们不是生成引擎输出样本。

这三个文件由 Linnya 项目在 2026-04-02 的 AI PPT Phase
0 开发中使用 PptxGenJS 生成，只包含为解析和编辑测试构造的合成内容，可以随项目源码分发。真实测试直接读取这些文件；不要再增加只检查 fixture“存在且非空”的 scaffold 测试。

## `fidelity-corpus/`

文本布局保真语料，覆盖字体度量、autofit、行数、行文本、内容高度、font
identity 与关键 OOXML 字段，不承担完整视觉校准。

其中三个 PPTX 由 Linnya 项目在 2026-07-07 的文本布局保真工作中生成，只包含专门构造的排版回归内容，可以随项目源码分发；具体生成器元数据与测试边界见子目录 README。

需要跑真实 Agent、比较模型设计质量或人工审核 PowerPoint 时，注册
[`apps/linnya-benchmark`](../../../../../../../apps/linnya-benchmark/README.md)
case，不在这里另建 audit registry、seed 脚本或手工抽检池。
