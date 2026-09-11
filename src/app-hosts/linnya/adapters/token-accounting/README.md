# Token Accounting Host Adapter

本目录是 Linnya Host 的 token
accounting 实现边界。它把 Linnkit 的 vendor-neutral 计数与账本合同连接到当前模型 route、上游协议的 preflight
count surface、actual usage 校准样本和 run cost 聚合。

## 目录职责

- `definitions/`：Host 内部 count surface、resolved request 与 capability 合同。
- `functions/`：Provider request/header/endpoint 投影和 response 严格校验。
- `registry/`：`TokenRoute.capabilityId` 到已批准 count capability 的显式绑定。
- `orchestration/`：实现 `TokenCounterPort`，以及 child-run cost
  telemetry 的窄适配。
- `collectors/`：actual usage 校准样本与 run/child-run token cost 聚合。
- `index.ts`：唯一公开入口；调用方不得导入内部文件。

## 负责与不负责

本模块负责：

- 始终使用当前 `TokenRoute.baseURL`，不根据模型名改发厂商官网。
- 认证 profile 读取 typed inference route；secret 与 Linnya Cloud 设备身份通过 Host `model-request-auth` 边界按请求解析，不读取 ModelConfig 通用 header。
- 仅在 route 明确声明 remote count 时执行一次请求，不做 retry/fallback。
- 将已核验 count surface 的请求和响应投影为 `TokenCountResult`。
- 只把 `confidence=actual` 的 response usage 配对成 route-isolated 校准样本。
- 聚合 run/child-run token ledger，并在任一 actual usage 缺价时保持 cost
  unknown。
- 生产通过 `agent_run_costs` 保存最小累计账本与父子关联，不依赖可关闭 Audit 或短期 Telemetry。
  checkpoint 提交前执行账本持久屏障；重启恢复累计用量，继续不重置。崩溃时未报告 usage
  的 LLM attempt 按 execution 身份只标记一次不确定性，不能补成 0 或伪造厂商费用。

本模块不负责：

- Provider 推理、stream、response usage provenance 投影或模型切换。
- 上下文截断规则、本地 tokenizer、canonical ledger 数学和价格计算规则。
- 从模型名、URL 或旧 adapter 名推断 count surface。
- 长期 telemetry 存储、UI 展示或 Cloud 网关实现。

最小恢复账本只含计数、价格可信度和关联，不保存 prompt/response/stream；随 run 删除级联清理。
它不是永久诊断平台，也没有新增产品费用硬限制。

AI SDK 的单 step raw usage projector 属于 `adapters/inference`；Linnkit 的 token
contracts、ledger 与纯聚合继续属于 Linnkit。已删除的旧 Provider codec 不能作为 count
request builder 或 usage fallback 被恢复。

## 支持面与扩展规则

默认 registry 只注册当前协议可核验的 `token-count:anthropic-messages`、
`token-count:gemini-generate-content` 与 `token-count:zai-tokenizer`。这些值只标识
Host count capability，不表达 Provider 产品归属。新增 surface 必须同时提供：

1. 官方 endpoint/request/response 依据；
2. 严格 request/response codec 测试；
3. route/base URL、认证头、Abort、单次 fetch 和错误脱敏测试；
4. Model Catalog 中显式开启 `supportsRemoteTokenCount` 的生产 route。

禁止用递归字段扫描、Provider 别名、模型名前缀或未验证 endpoint 扩大支持面。

当前 remote count codec 只接收文本与工具历史。图片仍由 Context
Manager 的本地 route-aware estimator 处理；携带 Provider
continuation 的历史也会明确拒绝 remote
count，由既有 policy 决定是否使用本地估算。只有在 count
 codec 能复现对应 Provider 实际请求时，才能解除这两个限制，禁止静默少算。
