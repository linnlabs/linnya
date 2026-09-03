# Native Math Formula Engine

`backend/engine/mathFormula` 是原生数学公式的唯一编译与 PPTX patch owner。它把同一份受控 LaTeX 编译为内部 canonical IR，并从该 IR 分别产生 MathML/MathJax SVG 投影和 PowerPoint OMML；两端不得各自重新解析源码。

## 模块

```text
mathFormula/
├── definitions/     # backend-only canonical IR 与稳定编译错误
├── compiler/        # closed parser、MathML/MathJax SVG projection、OMML emitter
└── pptx/            # typed patch plan、精确替换与 package validation
```

## 运行链

```text
MathFormulaSource
  -> parseLatexFormula()          # 整条公式共享深度、节点、矩阵预算
  -> CanonicalFormulaIr
       -> emitFormulaMathMl()     # 仅供本次编译使用的 Presentation MathML
       -> MathJax 4 + STIX2       # self-contained path SVG 与真实排版 metrics
       -> emitFormulaOmml()       # block / same-paragraph inline OMML
  -> FormulaPptxPatchPlan
  -> PptxPackageSanitizer
       -> marker exactly one
       -> placeholder exactly one
       -> a14:m / m:oMath 验证
       -> placeholder 必须清零
```

块公式替换整个 placeholder 文本体；行内公式只替换原 `a:p` 中对应的 rich-text run，并保留前后普通文字。PptxGenJS 在 rich text 中产生的重复 `a:pPr` 会在公式 patch 时收敛为一个合法段落属性节点，避免 Office 修复文件。

## 边界与维护

- parser 是闭集，不加载 TeX package、不执行宏、不调用外部 LaTeX 进程。
- MathML 是 backend 内部瞬时投影，不进入 DeckSpec、RenderModel 或持久化合同。
- SVG 与 OMML 必须来自同一 IR；新增语法时同时补两种投影和代表性 corpus。禁止重新引入手写字宽、字距或上下标定位，公式排版只有 MathJax 一个 preview owner。
- MathJax 固定使用随插件打包的 STIX2 字形与 local font cache，输出必须是 self-contained path SVG；运行时不得访问 CDN、本机字体，也不得以 `<text>`、普通文字或图片兜底。不在数学字形集内的说明文字应放在公式外的普通文本中。
- MathJax `LiteAdaptor.outerHTML()` 不会正确转义 attribute value 中的 `<`；`altText` 必须由本技术 adapter 在 SVG 序列化后按 XML attribute 规则注入 `aria-label`，避免底层 serializer 的不完整转义或预转义造成的二次编码。作者说明中的 `<`、`>`、`&`、引号均是合法输入，不能要求文稿自行转义，也不能以删除无障碍语义规避解码错误。
- backend、build Worker 与 standalone CLI 共用 artifact 内唯一的私有 `slides-mathjax-runtime`；各入口不得再次内联或复制 MathJax 字形数据。该 runtime 只提供同步 MathML → SVG 技术 adapter，不拥有公式 source、IR 或领域错误。
- MathJax 的 `viewBox` 可以包含负坐标。renderer 只能依据 `contentViewBox - viewBox` 的相对偏移放置墨迹，不得假定原点为零。
- 公式 patch 复用 sanitizer 生命周期，但 marker、placeholder 和 validator 仍由本模块拥有；不要扩成任意 OOXML 插件系统。
- 前端只消费 [`shared/mathFormula`](../../../shared/mathFormula/README.md) 投影；公式断行只属于 [`shared/textLayout`](../../../shared/textLayout/README.md)。
- PowerPoint 真实打开、双击编辑、保存后重新解包是发布 gate；ZIP/XML 测试不能替代该项。
- MathJax 与 STIX2 font package 均为 Apache-2.0，许可证随插件分发于 `resources/third-party/mathjax-LICENSE.md`；升级版本时必须同步复核。

## 验证入口

- compiler 与 profile：`compiler/compileMathFormula.test.ts`
- PPTX block/inline patch：`pptx/applyFormulaPptxPatches.test.ts`
- 本机 PowerPoint smoke：`dev/tools/mathFormulaPowerPointSmoke.ts`
