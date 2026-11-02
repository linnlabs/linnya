# Conversation artifact 删除适配器

实现 App conversation lifecycle 的窄删除端口。运行 owner 停止、输出落盘完成后，删除当前会话的
工具输出、证据和原始命令输出。项目删除复用同一生命周期；清空工作目录不触发 artifact 删除。

生产装配传入既有 `Artifacts/v1/conversations` 根，不调用会创建目录的 getter 来计算待删除目标。
原始命令输出复用 command output owner 的摘要路径；历史工具输出使用原会话 ID 的目录布局。
历史 sanitizer 会替换字符或截断 ID，因此遇到这种 ID 且对应目录存在时不能证明独占归属，必须
报告清理失败并保留 cleanup job，不能猜测所有者后删除。正常 UUID 会话没有这类歧义。

共享资产不属于此端口：删除事实只释放引用，实体字节由 asset owner 的无引用 GC 回收。
