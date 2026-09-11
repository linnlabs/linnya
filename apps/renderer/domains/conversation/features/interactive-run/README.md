# Interactive Run

该 feature 拥有 conversation 前台 Agent run 的控制状态，以及 `wait_user` 的一次性恢复身份。

暂停与审批是不同控制操作。空草稿运行中显示暂停，已收口的暂停显示继续；有可发送内容时沿用
正常发送，新消息接纳失败仍保留原暂停运行。继续只传 run / execution / updated-at 身份，不写
用户消息。SSE 断开只释放订阅；状态查询必须能立即返回仍在执行的 run，不能等待它最终完成。
暂停 SSE 是提示，正式继续凭证由精确 settlement 查询读取。异步查询只允许收敛发起它的 reader
代次；旧 reader 收尾或迟到查询不得覆盖新的发送、继续或取消状态。

- 状态按 `conversationId` 分区，切换对话只改变读取对象，不销毁后台 run。
- `awaiting_user` 是非终态，输入区仍显示“终止”；SSE transport 结束不会把它改成 completed。
- 只有同 conversation/run/execution 的 `run_status` 可以更新业务状态；`context_usage_snapshot` 与
  `run_execution_metrics` 只修订消息 read model，`transport_end` 只释放同 execution controller。
- 恢复必须提交同一组 `runId + interactionId + toolCallId + checkpointRevision + resumeToken`。
- 这组身份只服务 response command 与 Host admission。消息中的 active interaction 可以保存恢复凭证；terminal interaction 只保存 `status / submittedAt / response`，不得复制 run、checkpoint 或 resume 身份。
- host 先原子认领 interaction；输入事实落盘成功后才激活原 run。落盘前失败会释放认领，用户可重试；重复提交和身份不匹配会被拒绝。
- `auxiliary/visibility=none` 事件不进入该状态机，标题等辅助 run 不拥有正文控制面。
- transport 投影因 auxiliary/none 被拒绝时，请求调用方仍必须收到收尾通知；“是否投影消息”与“当前 reader 是否结束”是两个独立职责。
- transport failure 必须先完成 reader teardown 和 controller 释放，再按捕获的 `conversationId + runId` 请求 Host settlement；仍 running/pending 时立即返回，已进入结算才等待 exact execution completion barrier。active/paused/awaiting-user/new execution/terminal/null 分支只收敛本 feature 的 control snapshot，不补造 RuntimeEvent。
- store 只同步持有快照；网络请求和多步骤恢复流程放在 orchestration。
- 错误提示属于产生它的 conversation snapshot。用户关闭横幅时只清除该会话的 `error`，保留 terminal run 身份；不得通过组件本地隐藏状态掩盖 store 中的错误，也不得清除后台会话的错误。横幅锚定 ConversationHost 表面，不参与历史滚动。
- Renderer 持有当前 execution 的 realtime reader 时，Runtime `error` 先由消息投影器归一化为用户文案，再写入同一 conversation snapshot；interactive run 不重复解释错误码。CLI 等外部进程发起的 execution 没有当前 Renderer reader，其 durable error 仍供历史与审计读取，但不会凭数据库投影主动触发实时横幅。

消息投影与 run 控制状态是两类事实：问卷卡属于消息 read model，是否仍可提交以这里的 pending interaction 为准。

修改本 feature 的恢复协议时，业务测试必须经过真实 SQLite UI 投影，并同时验证 active 卡、terminal committed fact、当前 SSE 和重载窗口。MemoryEventStore 只适合控制并发测试，不能替代 durable read-model 门禁。

网络命令失败必须调用 active-run query 对账。查询到原 run 时恢复其权威状态并保留错误提示；服务端确认无 active run 时才进入 failed。禁止把 `submitting/cancelling` 当成无需收尾的本地临时态。

已经获得 run identity 的 transport failure 使用精确
`GET /conversations/:conversationId/runs/:runId/settlement`；新消息尚未接纳时才查询当前 active run，
以恢复可能被保留的旧暂停运行。服务端确认 `null` 才进入 failed；查询失败进入 reconnecting，
无 reader 时按会话顺序观察，恢复连接后收敛真实状态，不把网络错误当作逻辑运行失败。
原 interaction 仍 awaiting-user 时恢复同一组正式 pending 凭证，允许用户重试。

cancel 的成功响应不是固定 `cancelled`：Host 会返回 `cancelled` 或
`already_terminal + completed/failed/cancelled`。Renderer 必须按 `terminal_status` 收敛控制态，
中止旧 reader，再重读 durable window 与已展开 subrun trace。自然完成恰好赢过用户点击属于
正常竞争，不得再发 active-run 查询，也不得伪造成 HTTP 409 或本地 cancelled。
