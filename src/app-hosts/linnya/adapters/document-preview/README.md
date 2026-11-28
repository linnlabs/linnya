# 文档预览 Host 适配

`createWorkspaceDocumentPreviewReader`
装配 Workspace 身份、Markdown/插件 provider、文本回退和有界文件缓存。Markdown 的正文规则归 Markdown
owner；其他文档类型的只读渲染仍由其正式 provider 提供。

`createMarkdownPreviewResources` 只负责跨域组合：引用经 documentReferences
SDK 解析当前源/目标项目范围；受管图片经 documentImageAsset
SDK 验证文档归属与内容完整性；手动图片复用 media feature 的 `doc-image`
locator 解析，并收窄到源文档私有目录。后者与 Electron 协议共享路径规则，禁止另写一个任意 src/file
reader。预览只派生有界像素，不建立媒体目录、不注册资产、不修改原始图片。

图片分两步提供。列清单时只要尺寸：受管图片第一次遇到要经 documentImageAsset 整张校验并解码（1200 万像素的照片约 0.1 秒一张），资产按内容寻址、不可变，所以尺寸按 assetId 记在进程内存里，之后每次只做一次归属查询；手动图片只读文件头。取字节时（`readImageVariant`）先核对归属，再按“图片身份 + 档位”查 `document-preview-images/` 的磁盘缓存，没有才缩放并写入；同一张图同一档的并发请求合并成一次。受管图片的身份是 `asset:<assetId>`，手动图片是路径、修改时间和大小。缩放不放大原图；JPEG、WebP 保持原格式，其余转 PNG 以保留透明度，GIF/SVG 等取静态首帧。完整正文、图片身份、图表 spec 与样式继续放在 canonical
JSON，展示处理交给内容 owner 的唯一只读 renderer。

格式和缓存合同见
[Markdown 预览](../../../../domains/markdown/features/document-preview/README.md)
与 [document-preview](../../../../domains/document-preview/README.md)。
