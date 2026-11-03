# Markdown document core

本包拥有标准 doc/paragraph Markdown 正文的纯 schema、转换和只读 DOM 投影，供 Host Editor、插件 Renderer 与后台渲染 Worker 共用。无 Vue、Pinia、Node 内置模块或 Host 状态；模块导入和 Markdown 转换不访问全局 document。

`createMarkdownDocumentExtensions` 提供一份 Tiptap 内容定义，Renderer 可以传同名 NodeView 扩展替换表现；未知 JSON 节点、mark、attrs 由 `assertMarkdownDocument` 拒绝。`parseMarkdownDocument` / `serializeMarkdownDocument` 使用相同 schema 和 Markdown handlers。`createMarkdownDocumentFragment` 只使用调用方给出的 Document，生成的内容应放入 `.markdown-document-content`，并加载公开 `style.css`。

此包不拥有文档 ID/路径解析、引用权限、Workspace rootBlock、保存、修订、图片接管或模型调用。HTML 块默认显示源文，不执行嵌入内容；Host 如需 HTML 预览，应在自己的 NodeView 使用既有净化器。

`./validation` 是纯 JSON/schema 校验子路径，只有类型依赖；只需校验的存储消费者使用此入口，避免初始化正文扩展、Markdown parser 或公式 renderer。CSS 明确列为 package side effects，其余模块允许正常裁剪。

运行本包 typecheck 及 Node/DOM 业务测试；正文定义变更必须同时验证交互编辑和 Worker 投影，不能复制出另一套渲染 schema。

## 正式正文与可逆投影

节点沿用官方 `inlineMath` / `blockMath`，公式属性为 `latex`。行内样式包括 underline、highlight、textStyle（仅 color）、subscript、superscript；不开放字体或字号属性。JSON 准入同时检查未知属性、公式/颜色值类型与 ProseMirror 内容结构。

Markdown 使用 `++下划线++`、`==高亮==`、`~下标~`、`^上标^`、`$行内公式$` 与独立 `$$` 公式块。颜色使用官方 shortcode 形式 `[textStyle color="%23C00"]正文[/textStyle]` / `[highlight color="yellow"]正文[/highlight]`，属性值按 URI 编码转义；没有颜色的 highlight 仍输出 `==正文==`。这些 handlers 不经过 HTML/DOMParser，因此 Node 与 Renderer 解析一致。空或换行的行内公式用 `[inlineMath latex="…"]` 显式表示，公式里的 `\$` 保留为 TeX 转义，不误当结束符。普通 Markdown 强调、链接、代码、列表与表格规则继续复用官方扩展。

交互公式与只读 DOM 使用同一 KaTeX 信任、错误与 displayMode 配置，禁止 TeX 授予 HTML/链接权限。只读 fragment 会生成真实排版 DOM，调用方加载 `style.css` 即同时带上对应公式字体；不创建 Editor 或 NodeView。HTML 源文仍保持原有只读原文行为。

Tiptap 固定为 3.31.3；mathematics 的 peer 仅接受 KaTeX 0.16～0.18，因此这里精确使用 0.18.10。0.18.11 曾误以补丁版本发布 breaking strict 行为且已被上游弃用，0.19 不在当前 peer 范围内；升级必须与 Tiptap peer 及交互/只读公式回归一起进行。依据：[Tiptap mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)、[Markdown 扩展合同](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)、[KaTeX 0.19 说明](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0)。
