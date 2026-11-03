# Markdown document core

本包拥有标准 doc/paragraph Markdown 正文的纯 schema、转换和只读 DOM 投影，供 Host Editor、插件 Renderer 与后台渲染 Worker 共用。无 Vue、Pinia、Node 内置模块或 Host 状态；模块导入和 Markdown 转换不访问全局 document。

`createMarkdownDocumentExtensions` 提供一份 Tiptap 内容定义，Renderer 可以传同名 NodeView 扩展替换表现；未知 JSON 节点、mark、attrs 由 `assertMarkdownDocument` 拒绝。`parseMarkdownDocument` / `serializeMarkdownDocument` 使用相同 schema 和 Markdown handlers。`createMarkdownDocumentFragment` 只使用调用方给出的 Document，生成的内容应放入 `.markdown-document-content`，并加载公开 `style.css`。

此包不拥有文档 ID/路径解析、引用权限、Workspace rootBlock、保存、修订、图片接管或模型调用。HTML 块默认显示源文，不执行嵌入内容；Host 如需 HTML 预览，应在自己的 NodeView 使用既有净化器。

运行本包 typecheck 及 Node/DOM 业务测试；正文定义变更必须同时验证交互编辑和 Worker 投影，不能复制出另一套渲染 schema。
