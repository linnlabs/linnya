# Conversation activity

向项目查询与未来侧栏提供只读的当前运行事实；不存状态，不拥有已读通知、执行控制或恢复许可。

RunRegistry 的前台根运行是唯一生命周期事实源，沿用 Conversation Control 的选择规则：优先活跃根运行，否则最近终态；后台标题生成与子运行不替代前台根。Commands 唯一审批 owner 提供该根及后代的真实 pending，processing 不算等待回复。

已完成映射 idle；失败、取消、已收口暂停映射 interrupted。未收口运行中，真实审批优先于 awaiting_user（awaiting_answer），其余 pending/running/暂停收口映射 running。审批端不可读时明确 unavailable，不用零个审批冒认正在运行。保留原始 run_status、run_id 和暂停收口信息，不能根据简化 state 决定能否恢复。没有前台运行时 source=none，不从 UI 消息、选中的 Agent 或后台 run 猜测。

读取不会消费中断标记；用户查看后通知消失属于另一个展示合同，不改变最后运行事实。项目授权由调用方先完成，窄 ports 只负责按 conversation 读取事实。

列表使用 run-registry adapter 的批量轻投影：所有活跃前台根、最新终态根与这些根的后代。状态集合与最终选择复用 Conversation Control；不读取每轮 prompt/执行 metadata，不能只取时间最新的根（较旧根仍可能活跃）。结果不是缓存，审批每次读同一 owner。
