# Document image assets

该 app-level
use case 负责把“本地图片或图片字节”接管为文档拥有的内容寻址资产，并在接管后只通过 durable
ownership 读取。它编排 Asset domain 的 ingress/ledger 与 Workspace
ownership，但不把任一 domain 的内部异常暴露给文档插件。

`document_asset_links` 的窄 adapter 已归属 sibling `document-assets` use case；Image 与 SVG
各自保留独立 ingress/验证，只共享最终的文档归属事实。

对外失败统一为
`DocumentImageAssetRuntimeError.failure`：来源缺失、来源不可读、媒体无效、媒体超过限制、ownership 缺失、受管资产不可用/完整性失败、存储冲突和存储不可用。插件 SDK 会把这些事实等值映射为
`PluginDocumentImageAssetError`；插件不得根据底层异常文案猜分类，也不得显示解析后的 AppData、SQLite 或受管 blob 路径。

这个 use case 不负责下载网络图片。使用文档图片的 Agent 新下载或转换文件时，默认让 Shell
使用默认 cwd 和相对 OS 路径写入当前 conversation 工作目录；用户指定其他落点，或当前任务已有
对应写权限时，也可以写入真实外部路径。显式 cwd 与 `requires_write_access` 本身不是额外授权。
已经存在、已获准读取的本地文件可以来自其他位置。文档采用后，原路径只保留来源含义，文档读取
不再依赖原文件。
