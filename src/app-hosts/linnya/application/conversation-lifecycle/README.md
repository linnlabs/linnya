# Conversation Lifecycle Use Case

## 1. 为什么需要 use case

清空目录、删除对话涉及 conversation-files、Commands owner、Flow、History、审批、卡片事实和 EventStore。任何一个 domain 都不应该知道其他 domain 的删除顺序，因此把跨 domain 的生命周期放在 App Host use case。

## 2. 公开用例

| 用例 | 语义 |
| --- | --- |
| `requestWorkDirectoryClear` | 只清空当前对话工作目录，保留聊天和 durable UI 事实 |
| `requestDeletion` | 完整删除工作目录、批准、卡片事实、对话事实和 identity metadata |
| `recoverPending` | 启动时恢复尚未完成的 cleanup job |
| `stopConversationActivityAndWait` | 停止 Flow/Commands owner，并等待事实收口 |

## 3. 固定顺序

```text
短 gate：检查冲突 → 写 cleanup job → 写 stopping tombstone
释放 gate
停止 owner/Flow，等待 tree empty、output drain、audit drain
按操作类型删除目录和持久事实
全部成功 → complete job；失败 → 保留 job + diagnostics
```

gate 只保护 admission，不在 gate 内等待进程或删除文件；否则新命令和删除会互相等待。cleanup job 是跨重启的真源，内存 gate 只是加速器。

## 4. 不变量

- gate 按 conversation 分区，另一对话不受影响。
- cleanup job id 每代唯一且不可复用，迟到 worker 必须拒绝。
- History repository 不能绕过 use case 直接删除事实。
- 删除期间不允许新的 command reserve、approval claim 或目录 materialize。
- 失败要可观察；不能把“目录删除失败”伪装成对话已删除。

## 5. 异常和人工恢复

Windows 文件锁、权限不足或损坏文件系统可能让 `fsp.rm` 永久失败。实现必须保留失败 job、失败次数和最近原因，并由产品界面提供“清理失败，需处理”的出口；在没有明确恢复合同前，不应无限重试并让用户完全看不到原因。

## 6. 测试门禁

集成/E2E 覆盖活动命令删除、重复删除、精准清理升级、迟到 admission、跨重启恢复、清理失败、另一对话并发以及 App end。不要用单独 Renderer 测试证明后端删除已完成。
