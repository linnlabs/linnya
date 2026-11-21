# Conversation activity

向项目查询与未来侧栏提供只读的当前运行事实；不存状态，不拥有已读通知、执行控制或恢复许可。

RunRegistry 的前台根运行是唯一生命周期事实源，沿用 Conversation Control 的选择规则：优先活跃根运行，否则最近终态；后台标题生成与子运行不替代前台根。Commands 唯一审批 owner 提供该根及后代的真实 pending，processing 不算等待回复。

已完成映射 idle；失败、取消、已收口暂停映射 interrupted。未收口运行中，真实审批优先于 awaiting_user（awaiting_answer），其余 pending/running/暂停收口映射 running。审批端不可读时明确 unavailable，不用零个审批冒认正在运行。保留原始 run_status、run_id 和暂停收口信息，不能根据简化 state 决定能否恢复。没有前台运行时 source=none，不从 UI 消息、选中的 Agent 或后台 run 猜测。

读取不会消费中断标记；用户查看后通知消失属于另一个展示合同，不改变最后运行事实。项目授权由调用方先完成，窄 ports 只负责按 conversation 读取事实。

列表使用 run-registry adapter 的批量轻投影：所有活跃前台根、最新终态根与这些根的后代。状态集合与最终选择复用 Conversation Control；不读取每轮 prompt/执行 metadata，不能只取时间最新的根（较旧根仍可能活跃）。结果不是缓存，审批每次读同一 owner。

## 全工作区列表与变化信号

`listConversationActivities` 供侧栏使用（`GET /api/v1/conversation/activity`）：adapter 先用 `idx_runs_status_start_ts` 取候选超集——有活跃前台根，或最近一次终态前台根是 failed/cancelled 的对话（终态先后与 `readCandidates` 同序），再交给上面的批量投影，只返回非空闲对话及其 `project_id`。2026-11 本机实测 4.3k 对话、4.27 万运行时候选查询不到 1 ms，整次读取约 13 ms；不加索引提示时规划器会扫 parent_run_id 索引（约 6 ms）。

界面何时重读由 Host 推送，不轮询：runs 表的写入者（run-registry store、event-store、history-mutation 三个文件）在写入后调用 `run-activity-signal` 的 `notifyRunActivityChanged`，`connectConversationActivityChanges` 把 50 ms 内的通知合并成一次 `publishConversationActivityChanged()`。run-registry 只在新运行、状态或暂停收口变化时通知，运行中保存当前节点不发信号。接口挂载、订阅接上后组合根立即发一次，覆盖订阅前的启动恢复收口（含 App Server 重启）和早于接口挂载就读取失败的窗口。新增 runs 写入 SQL 必须放在这三个文件并发出通知，由 `run-activity-signal/__tests__/runWriteOwnership.test.ts` 检查。审批变化不经过这条信号，Renderer 复用已有的审批推送触发重读。

“看过中断”是 Renderer 的展示记录（按 run_id 记，带首次启用基线），不进入本模块，也不改变运行事实。
