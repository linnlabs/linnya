# Slides 图片编辑

本 feature 拥有本地图片接管、替换与 contain/cover 入口。公开 `importSlideImage` 供新增对象复用，公开 UI 供命令栏装配。FileReader/createImageBitmap 只读取待导入文件的内容和尺寸；后端 Host 资产门面仍负责实际媒体校验与持久归属。

允许不超过 20MB 的 PNG、JPEG、WebP。IPC 接管成功后返回文稿拥有的 immutable asset ID；insert/set_image 只传 ID。替换保留原外框，cover 为居中填满而非自由裁剪。取消文件选择不产生操作，导入错误明确显示。

后台按 document_asset binding 核对归属，不允许从其他文稿借用 ID。完整编译记录新的资源可达集合，投影继承基线集合，Undo 恢复历史集合；后台集成场景覆盖替换/删除/压缩/恢复。失败导入后未被使用的受管资源仍走既有历史维护和资产 GC，不另设清理系统。
