# 插件文件输入

这个 Host
adapter 只管理一次文件输入的暂存副本，不授予任意路径访问。HTTP 单文件上传与 CLI 会话导入使用同一个 50
MiB 上限和 `uploads/temp`
目录；任务正式接纳后才转交清理责任，未接纳的副本在请求结束时删除。

CLI 只接受正式 `conversation:/` locator。复制全过程位于现有 Conversation
admission 中，复用 file-read 的真实路径、根范围和普通文件检查；流式复制保留磁盘背压与父调用取消。插件收到暂存副本，不能获得或删除原件。没有新的原文存储或备份。
