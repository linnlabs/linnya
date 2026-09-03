# Conversation Work Directory

## 责任

该 feature 负责一个 conversation 的稳定目录 identity、真实目录创建/恢复、owner marker 校验和只读占用计量。它只提供 port，不直接调用 Commands、History、Workspace 或 Electron。

## 核心接口语义

- `resolvePath(conversationId)`：只校验 id 并计算稳定路径，不创建目录。
- `ensureDirectory(conversationId)`：检查目录类型、identity marker 和 metadata；只有合法时才接管或创建。
- `measureDirectoryTree(conversationId)`：只读扫描，返回 `not_created`、`previous_files_unavailable` 或 `available`，不修改目录。
- `resolveWorkingDirectoryAdmission`：在 cleanup job 和 unsafe entry 检查通过后给 shell runtime 一个 cwd。

## 身份和恢复

目录 key 由完整 SHA-256 conversation id 推导，不能用标题、序号或 path sanitizer。owner/initialized metadata 在目录外，Agent 删除所有工作文件不会损坏归属。目录缺失但 initialized marker 合法时允许重建并返回 `recreated_missing`；符号链接、junction、普通文件冒充目录、marker 不匹配都 fail-closed。

## 风险

任何接收 Agent cwd 的代码都不能直接 `join` 后删除或创建；必须回到该 feature 的 port。计量遇到单个 unsafe/不可读目录应返回单项 unavailable，让 storage-space 总览仍能展示其他对话。

## 测试

覆盖首次创建、恢复、改名不影响 identity、缺失重建、symlink/junction、坏 marker、文件锁、计量不创建目录和两个 conversation 并发准入。
