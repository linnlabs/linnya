# Export Artifact Commit

该 application feature 连接 App Server 中的插件导出与 Electron Main 拥有的一次性保存目标。Backend 只依赖 `ExportArtifactCommitPort`，看不到保存框、真实路径、Electron 或 RPC peer。

完整 bytes 先写入 AppData 私有 mailbox；RPC request 只携带 operation id、随机 token、插件身份、文件类型和完整性事实。Desktop 读取并校验 mailbox 后调用 `commitExportArtifactTarget` 原子发布，随后清理本轮目录。大二进制不得改回 JSON/base64 内联，也不得复制保存 token registry 到 App Server。

该 feature 只有一个跨进程用例，不是通用文件 RPC。新增导出格式应复用 `system/export` facade，而不是扩大这里的 method table。
