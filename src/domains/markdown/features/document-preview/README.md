# Workspace Markdown 只读预览

`createMarkdownPreviewCapability` 是 Markdown 文档预览的唯一 Backend
provider。输入是正式 `document_versions.content_json`
与当前持久化 Pending，输出是 `workspace-markdown` 详情：完整 rootBlock
JSON、只读图片 data URI 和当前可见的引用呈现。它不使用 Agent/VFS
Markdown 投影，也不生成另一份文字摘要 SVG。用户可见摘要只取正文文字、图片题注与引用标题，不暴露图表 JSON、资源 locator 或 Markdown 标记。

未决修订先经 `pending-revisions.preparePendingReplacements`
恢复图片、引用与 citation，再调用接受操作共用的
`applyAcceptedPendingsToDocument`
纯函数。该读取不会接受/拒绝修订、创建正文版本、清理 Pending 或注册资产。全部块待删除时，详情允许空
`doc.content` 表示空白预览；持久化正文仍必须遵守可编辑文档的 rootBlock+ 规则。

Host 注入 `MarkdownPreviewResources`
窄 port。正式受管图片通过文档归属读取；Renderer 手动插入的文档私有媒体经相同
`doc-image` locator 解析并验证源文档私有目录。资源 map 使用
`assetId ?? image.id`，同一文档内同一受管资产只读一次，按顺序解码以限制峰值。Host 将长边收敛至 2048 像素，保留透明度；GIF/SVG 等转静态首帧。未有正式来源的空图片仍保留结构，由统一 Renderer 明示缺图；不任意抓取 src、不丢掉图片节点。整篇图片均保留，因此总 payload 仍随文档图片数增长，消费者必须使用有界预览缓存。

引用只解析身份、状态和当前授权标题，不递归读取目标正文。revisionKey 包含
`workspace-markdown-v1`
合同版本、真实正文来源版本/结构、Pending 全量状态与当前引用呈现。旧 Agent 文本缓存不能命中。通用 document-preview
reader 在缓存读取、渲染完成及缓存写入后重验来源版本与项目范围；变化返回
`preview_unavailable`，调用方在正式文档变更或重试时重新读取。

业务验收在
`src/app-hosts/linnya/adapters/document-preview/__tests__/markdownPreview.integration.test.ts`，覆盖真实 SQLite/WASM、两种正式图片来源、图表与样式结构、Pending 接受/拒绝前后、引用改名/越界、取消与只读无数据库写入；缓存并发与异步失效在 document-preview
owner 测试中验证。
