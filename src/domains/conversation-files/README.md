# Conversation Files Domain

## 1. 领域边界

`conversation-files` 管理每个 Linnya 对话对应的本地工作目录 identity、准入、恢复、占用计量和清理 job。它不是 Workspace VFS、附件仓库、ToolOutputStore，也不是系统临时目录；命令工具只是通过它获得一个安全 cwd。

## 1.1 物理目录与 Workspace VFS 的边界

这个 domain 管理的是操作系统真实目录。目录根由 App Host 注入，当前默认布局为：

```text
<appDataRoot>/ConversationWorkDirectories/v1/workspaces/conversation_<sha256(conversationId)>
```

`conversation_<sha256>` 是稳定的目录身份，不是用户可见的文件 locator。`workspace:/foo.md` 属于数据库 VFS；`conversation:/foo.md` 只是模型侧对当前工作目录文件的显式地址。本 domain 不负责解析 locator，也不负责把 VFS 文档 materialize 到物理目录或把 Shell 文件 commit 回 Workspace。

这条边界必须保持显式：Shell 的 `cwd`、目录清理和磁盘占用计量只针对物理目录；Workspace 文档读写只针对 Workspace DB。任何未来的转换能力都应作为独立、明确的用例定义输入、输出、权限和失败处理，不能在目录 adapter 中隐式完成。跨模块的产品合同见 [Commands README](../commands/README.md)。

## 2. 目录树

```text
conversation-files/
├── definitions/
├── features/
│   ├── work-directory/
│   └── directory-cleanup/
├── ports/                     # app host 注入文件系统实现
└── README.md
```

work-directory 负责“这个对话的目录是谁”；directory-cleanup 负责“删除或清空它时怎样阻止迟到操作”。上层应用用例负责把它和 Commands、History、Audit 或只读文件访问的顺序组合起来。

`read_file(locator=conversation:/...)` 的地址解析、文件格式和 asset claim 不属于本 domain。App Host 的 `application/file-read` 在 work-directory admission 回调内调用物理 reader：本 domain 只保证目录 identity 与删除生命周期不会竞态，物理读取能力不会反向依赖 conversation-files 的内部实现。

Conversation 回答中的 `conversation:` 文件链接同样不由本 domain 解析。App Host 的
`application/file-link` 复用 work-directory admission，并在 admission 回调内校验目标是目录内的真实普通
文件；点击只把准入后的绝对路径交给 Electron 的文件管理器定位能力。Renderer 只传
`conversationId + canonical locator`，绝对路径不得跨 IPC 返回。这样文件链接与 `read_file` 共享目录归属
和 symlink/realpath 边界，但保持两个独立用例。

原始文件仍是对话目录中的普通文件。reader 按真实签名字节识别图片，图片不接受 inode 或字符窗口。第一次成功读取后，图片会进入受管内容存储，并由 ToolNode 的 tool event 建立 conversation link；此后历史回放读取受管副本，不再依赖原始 CLI 文件。如果原始文件在第一次读取前被删除，读取应明确失败，不能按文件名寻找替代品。

Slides CLI 会在生成端先把页面 PNG 形成固定策略的 JPEG 检查图，并只保留当前文稿的最新成功版本。reader 不做二次压缩：模型本轮看到、tool event 引用和历史回放使用的是同一份 JPEG 字节，所以工作目录退休旧版本不会改写已经建立的历史事实。

## 3. identity 合同

- conversation id 先经过 domain schema 校验，再用完整 SHA-256 生成路径 key。
- 标题、序号、PID、用户输入的目录名和通用 path sanitizer 都不能参与 identity 推导。
- app data 根目录由 App Host 注入；domain 不依赖 Electron 的 `pathManager`。
- `resolvePath()` 只计算路径；`ensureDirectory()` 才创建目录。读取对话列表不能产生大量空目录。
- owner/initialized metadata 放在工作目录之外。Agent 可以清空工作目录，但不能伪造归属。
- 普通文件、符号链接、junction、错误 marker、conversation 不匹配的 metadata 均拒绝接管。

## 4. 准入和恢复

目录解析会返回 `created`、`existing` 或 `recreated_missing`。只有 identity metadata 仍然合法、工作目录本身缺失时，才允许重建空目录并报告 `recreated_missing`；发现 unsafe entry 或 marker 不匹配必须 fail-closed。

命令 admission 先检查 conversation cleanup job，再检查 owner 状态，最后才允许 shell runtime 使用 cwd。这样目录删除和迟到的 command start 不会互相覆盖。

## 5. 清理语义

| 操作 | 删除内容 | 保留内容 |
| --- | --- | --- |
| 精准清空工作目录 | 当前 conversation 工作目录 | 对话事实、批准、卡片、identity metadata |
| 完整删除对话 | 工作目录、批准、卡片和对话事实、identity metadata | 无 |

cleanup job 以 conversation identity 为唯一键，拥有不可复用的 job id。创建 job 的短 gate 内禁止新 admission；gate 外停止活动 owner、等待进程树/输出收口，再执行删除。失败必须保留 job 和诊断，不能静默放行新命令。

## 6. 占用计量

计量是只读、非事务快照。对未创建目录返回 `not_created`，历史文件不可读取返回 `previous_files_unavailable`，正常扫描返回 `available`。它不创建目录、不承诺文件系统实际分配块数，也不负责磁盘监控；存储空间设置页应对单个 unsafe/不可读项目降级，而不是让整个总览失败。

## 7. 风险和维护要求

- 不要把目录名改成标题或 slug，否则改名会丢失对话身份。
- 不要在 Agent cwd 内存放权限 authority、identity metadata 或清理 job。
- 不要把 `fsp.rm` 成功当作 owner 已停止；删除前必须完成 process owner 收口。
- Windows 文件锁、权限不足和损坏文件系统可能让清理永久失败；上层必须保留可观察的干预状态。

## 8. 测试门禁

work-directory/directory-cleanup integration 测试必须覆盖：首次创建、恢复、缺失、symlink/junction、坏 marker、精准清空、完整删除、重复 job、迟到 worker、跨重启恢复、活动命令删除和另一对话并发。storage-space 只测试它消费计量结果，不复制目录扫描算法。
