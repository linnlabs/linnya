# LLM Debug Evidence

这个 feature 只负责把 LLM 上下文和协议诊断转换成统一 Audit Domain 的 debug
evidence。它不拥有文件目录、数据库连接、配置开关或独立写入入口。

## 运行规则

- 只有统一等级为 `debug` 时记录；`standard` 和 `minimal`
  不记录大体积 LLM 输入证据。
- `debug` 只能在 `LINNYA_DEV_MODE=true` 的开发进程启用。
- 记录内容通过 `AuditPort` 进入统一 runtime；`llm.*` 证据由 Audit Domain 写入
  `<workspaceRoot>/Audit/v1/dev-diagnostics/<conversationId>/<runId>.jsonl`，不再写
  `<Documents>/LLMRunAudit/`、`.in_progress.json` 或单独的最终 JSON 快照。
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

允许记录为排查 context manager、输入物化和工具协议问题所必需的 debug
evidence。禁止记录凭据、完整环境变量、图片二进制、provider raw
request、无界 stdout/stderr 和与当前 run 无关的对象。单片段、单次 run、工具协议错误和 system
reminder 的容量限制由统一 orchestration 实现，不能通过新的环境变量覆盖。

本 feature 不负责 run lifecycle、Telemetry、checkpoint、内容历史、CLI 导出或 retention；文件容量和
TTL 由统一 Audit Domain 的 debug evidence adapter 负责。需要其他能力时，调用相应 owner 的公开 port/query。
