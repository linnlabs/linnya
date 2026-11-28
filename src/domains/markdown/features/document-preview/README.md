# Workspace Markdown 只读预览

`createMarkdownPreviewCapability` 是 Markdown 文档预览的唯一 Backend
provider。输入是正式 `document_versions.content_json`
与当前持久化 Pending，输出是 `workspace-markdown` 详情：完整 rootBlock
JSON、图片清单（来源和原始像素尺寸，不含字节）和当前可见的引用呈现。内容与请求的宽度、像素比无关（`sizeIndependent`），同一版本各入口共用一份结果。它不使用 Agent/VFS
Markdown 投影，也不生成另一份文字摘要 SVG。用户可见摘要只取正文文字、图片题注与引用标题，不暴露图表 JSON、资源 locator 或 Markdown 标记。

未决修订先经 `pending-revisions.preparePendingReplacements`
恢复图片、引用与 citation，再调用接受操作共用的
`applyAcceptedPendingsToDocument`
纯函数。该读取不会接受/拒绝修订、创建正文版本、清理 Pending 或注册资产。全部块待删除时，详情允许空
`doc.content` 表示空白预览；持久化正文仍必须遵守可编辑文档的 rootBlock+ 规则。

Host 注入 `MarkdownPreviewResources`
窄 port。正式受管图片通过文档归属读取；Renderer 手动插入的文档私有媒体经相同
`doc-image` locator 解析并验证源文档私有目录。port 有两个图片读取口：`readImageSize` 给清单用，只要朝向校正后的原始像素尺寸；`readImageVariant` 给 provider 的 `readImage` 用，按长边 512/1024/2048 返回一档缩好的字节，来源不属于该文档时拒绝。清单的键是
`assetId ?? image.id`，同一文档内同一受管资产只读一次，四路并行。生成预览不缩放任何图片：字节由呈现方按显示尺寸另取，首屏用不到的图不拖慢整篇预览，结果大小也不再随图片数成倍增长。Host 的实现见 [Host 适配](../../../../app-hosts/linnya/adapters/document-preview/README.md)。未有正式来源的空图片仍保留结构、不进清单，由统一 Renderer 明示缺图；不任意抓取 src、不丢掉图片节点。

引用只解析身份、状态和当前授权标题，不递归读取目标正文。revisionKey 包含
`workspace-markdown-v2`
合同版本（v2 起图片只列清单）、正文原文的指纹、版本号、Pending 全量状态与当前引用呈现。旧 Agent 文本缓存不能命中。判断版本是每次读取都要做的事：provider 按文档记住最近一次正文原文对应的指纹和它引用的文档，原文逐字相同才复用，不再每次把整篇正文解析、校验一遍；只记这两样不可变的事实，不缓存解析出的正文对象。通用 document-preview
reader 在缓存读取、渲染完成及缓存写入后重验来源版本与项目范围；变化返回
`preview_unavailable`，调用方在正式文档变更或重试时重新读取。

业务验收在
`src/app-hosts/linnya/adapters/document-preview/__tests__/markdownPreview.integration.test.ts`，覆盖真实 SQLite/WASM、两种正式图片来源、图表与样式结构、Pending 接受/拒绝前后、引用改名/越界、取消与只读无数据库写入；缓存并发与异步失效在 document-preview
owner 测试中验证。
