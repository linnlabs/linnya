# LLM Response / Stream Evidence

这个 feature 只负责把 LLM 上下文、上游响应摘要和协议诊断转换成统一 Audit Domain 的
response/stream evidence。它不拥有文件目录、数据库连接、配置开关或独立写入入口。

## 运行规则

- `behavior` 不记录大体积 LLM 输入；`response` 只允许安全投影后的上游响应摘要；`stream`
  才允许受限的上下文/协议诊断和流式片段。
- 当前 `response` 只提供 action 白名单和统一过滤合同；真实 Provider response producer
  将在后续阶段通过 Host port 接入，不能在本 feature 内读取 Provider adapter 的内部状态。
- `response` 和 `stream` 只能在 `LINNYA_DEV_MODE=true` 的开发进程启用；packaged Host 固定为
  `off`。
- 记录内容通过 `AuditPort` 进入统一 runtime，并写入当前 Workspace 的 `workspace.sqlite`，不再
  创建 JSONL 或其他独立正式审计文件。
- 记录前使用 Linnkit durable projection，拒绝图片 bytes、provider
  transient 字段和其他不可长期保存的值。
- AsyncLocalStorage 只保存当前异步链的运行身份，不把 audit
  context 发送给模型供应商。
- root run 保存 context-manager 前后和 system reminder evidence；child
  run 只保留 transcript、输入物化和工具协议错误，避免重复保存大快照。

## 公开使用方式

生产调用方从 `src/domains/audit` 导入 `runWithLLMDebugEvidenceContext`、`record*` 和
`flushLinnyaAudit`。不要导入本目录的内部 orchestration、不要读取旧的文件路径，也不要在调用方判断
`LINNYA_AUDIT_LEVEL`。

`flushLinnyaAudit` 的职责是排空当前 run 已经提交给统一 `AuditPort`
的异步写入队列。它不是“写文件”操作，调用方只负责在 run 结束时调用一次。

## 记录边界

允许记录为排查 context manager、输入物化和工具协议问题所必需的 response/stream
evidence。禁止记录凭据、完整环境变量、图片二进制、provider raw
request、无界 stdout/stderr 和与当前 run 无关的对象。单片段、单次 run、工具协议错误和 system
reminder 的容量限制由统一 orchestration 实现，不能通过新的环境变量覆盖；stream 单 run 总大小
上限为 16 MiB。

本 feature 不负责 run lifecycle、Telemetry、checkpoint、内容历史、CLI 导出或数据库 retention；
容量和脱敏在 evidence 投影阶段完成，持久化由统一 Audit/EventStore owner 负责，过期
`audit_envelope` 由启动维护按 7 天窗口清理。需要其他能力时，调用相应 owner 的公开 port/query。
