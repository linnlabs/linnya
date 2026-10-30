# Slides 图片编辑

本 feature 拥有本地图片接管与替换。公开 `importSlideImage` 供新增对象复用，公开 UI 供命令栏装配。FileReader 只读取一次文件内容；后端 Host 资产门面负责媒体校验、尺寸检查与持久归属。前端复用接管回执中的像素尺寸，不再额外调用 createImageBitmap 只为测量宽高。

允许不超过 20MB 的 PNG、JPEG、WebP。IPC 接管成功后按 shared/authoringEditing 的严格 DTO 返回文稿拥有的 immutable asset ID 和像素宽高；insert/set_image 只传 ID。替换保留原外框和作者写下的 fit。手动编辑不提供 contain/cover 开关：插入使用原图比例，缩放手柄对图片始终等比，外框与原图同比例时两种 fit 画面相同；作者版式里比例不同的图片位由 AI 决定 fit。取消文件选择不产生操作，导入错误明确显示。

后台按 document_asset binding 核对归属，不允许从其他文稿借用 ID。完整编译记录新的资源可达集合，投影继承基线集合，Undo 恢复历史集合；后台集成场景覆盖替换/删除/压缩/恢复。失败导入后未被使用的受管资源仍走既有历史维护和资产 GC，不另设清理系统。

`importSlideImage` 同时返回仅限当前输入会话的 data URI，供新增预览复用原始文件内容；它不回传图片字节、不扩张持久化命令。正式渲染仍经原有资源 registry 读取资产。verbose `ImageImport` 日志区分文件读取与接管耗时，不记录图片内容。
