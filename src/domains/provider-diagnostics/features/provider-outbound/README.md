# Provider Outbound Diagnostics

本 feature 是所有外部 AI Provider attempt 的安全诊断边界。它回答“哪条显式 route 在何时
发起、以什么状态结束、Provider 是否返回 usage”，不保存请求正文、响应正文或传输凭据。
它是进程内最新快照，不是 Linnya 的 durable Audit，也不得再被称作第二套审计。

## 职责

- `@app/schemas/provider-outbound-audit`：前后端安全 wire schema 与类型的唯一真相源；这个
  subpath 是待版本化迁移的历史名称，不代表 durable audit。
- `definitions/`：重导出 wire
  contract，并定义 Host 窄写入 port 与调试面只读 snapshot port。
- `functions/`：`started` 到唯一终态的纯状态转移。
- `orchestration/`：统一 begin/succeed/fail 生命周期与当前进程的最新 attempt 快照实现；不写盘、不进 EventStore。
- `index.ts`：Inference、OCR 与 Electron 调试面的唯一导入入口。

## 明确不负责

- 不构造 Provider request，不读取 SDK 对象、URL、headers 或 credential。
- 不保存 prompt、answer、工具 schema/arguments、base64、bytes、文件路径、continuation
  payload 或 Provider error body。
- 不拥有重试、fallback、计费、token 估算或 run lifecycle。
- 不替代统一 Audit Domain 的 EventStore 事实，也不替代日志、Telemetry 或 checkpoint。

## 状态与并发

生产者在真正进入 Provider capability 前写入 `started`，随后以同一个 `attempt_id`
写入一次 `succeeded` 或
`failed`。当新 attempt 已开始时，旧并发 attempt 的迟到终态不会覆盖最新快照；因此 debug
API 展示的是“最近开始的 attempt”，不是“最近完成的请求”。

## 依赖规则

Host producer 只依赖 `ProviderOutboundDiagnosticsPort`，debug route 只依赖
`ProviderOutboundDiagnosticsSnapshotPort`。跨 domain 调用统一从本 feature 的
`index.ts` 导入，禁止读取 orchestration 内部状态，也禁止让 diagnostics
feature 反向依赖 inference、OCR、Model Catalog 或 Electron。

## 测试门禁

模块集成测试必须覆盖成功、失败、usage 缺失、并发迟到终态和快照副本隔离；生产链测试还必须负向断言 prompt、正文、工具参数、base64、文件路径、API
key、continuation 与 Provider error body 不进入快照和 debug API。
