# 当前卡片内容投影

`createCanvasCardContent` 只持有可销毁的资源与身份缓存，不拥有正文或项目事实。受管图片正文只保存 assetId 与 asset: 源，读取后的 data URI 仅进入 DOM；图片缓存有 32MiB 上限。静态 DOM 与后台 worker 共用 cardRendering/content 的资产和标签水合函数。

文档卡及正文标签通过通用 documentReferences 查询当前身份；搜索预读全部引用目标，最多 8 个并发，不只读取视口中的目标。Workspace 正式 mutation 和 pluginRuntime 启停通知失效相关身份，世代进入正文位图键，迟到的旧请求不能覆盖当前标题。跨项目与删除状态移除标题，不能继续被搜索命中。消费者用 subscribe 重新调度受影响正文，关闭时 dispose 释放订阅和资源。
