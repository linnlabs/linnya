# Presentation Image Ownership

该 feature 管理 Slides 源码图片身份与 presentation-owned asset 的稳定绑定。

边界分成两层：

- `presentation_image_bindings`
  只回答“这个文稿里的某个源码图片身份首次接管成了哪个 asset”；它属于 Slides。
- asset 登记、`document_asset_links`、受管内容路径和完整性复核属于 Host 的 document
  image asset workflow；Slides 只能通过 `@plugin/backend/documentImageAsset`
  窄门面调用。

绑定采用 first-write-wins。源码路径只是首次导入的 provenance，不是 live
link；同一路径的源文件之后被覆盖或删除，不会改变已经绑定的图片。恢复历史 revision 或进行无关文字编辑时，必须沿绑定读取原 asset。用户要替换图片时应修改源码图片引用，而不是期待原路径内容被后台刷新。

`brush_artwork` 也是这条链上的图片来源。可写应用流程先用规范化 intent、最终元素盒派生的像素尺寸、
pinned 上游 commit 与 adapter version 形成 source identity，再由隔离 generator 生成不透明 PNG；字节仍交给
同一个 Host image asset workflow 接管。只读 CLI 只读取已经存在的 binding，不启动 GPU，也不根据当前
runtime 重算历史图片。同一 intent 在不同尺寸下必须拥有不同 identity，不能发生 first-write-wins 串图。

独立 CLI 使用只读 reader 和只读图片解析器，不执行接管或绑定写入。为了兼容接管机制上线前的历史 revision，源码中已经自包含的合法 data
URI 可以直接重放；未绑定的本地路径、file locator 和 conversation
locator 不能在只读流程中临时读取，必须先由可写的应用流程接管。远程 URL 在两条流程中都不受支持。

绑定跟随 workspace 文档删除而级联清理。`document_asset_links`
保存文档对所有历史 revision 图片的 durable
ownership，因此源码暂时删除某张图时不能立即删除旧绑定或 asset，否则历史恢复会失去字节事实。

## 错误合同

该 feature 只消费 `PluginDocumentImageAssetError.failure`，并映射为
`PresentationBuildFailureError`：远程 URL、本地来源缺失和无效媒体属于 source-fixable；ownership/binding 冲突与受管 store 不可用不属于 source-fixable。错误摘要不得包含解析后的 AppData、数据库或受管 blob 路径。任何新增资产失败都必须先扩展宿主 document
image asset 窄合同，禁止在 Slides 中重新根据底层错误文案分类。
