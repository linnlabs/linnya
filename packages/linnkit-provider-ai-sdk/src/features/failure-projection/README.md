# AI SDK Failure Projection

本 feature 是 AI SDK 已解码失败到 Linnkit canonical failure 的唯一投影边界。

## 职责

- 读取 AI SDK `APICallError`、SDK error class、decoded stream error 与 finish reason；
- 输出稳定的 `{ kind, code, retryable, retry_category? }` 或 canonical terminal event；
- 只保留无敏感信息的判别字段，不把 Provider message、response body、prompt、URL 或凭据带入 canonical 合同与日志；
- 用 fixture matrix 固化 HTTP、stream、finish、schema/JSON、empty/transport 与 Abort 语义。
- 通过安全 observation 只记录 phase、error shape 与 canonical failure，不记录原始 error message/stack/body。

## 不负责

- 不解析 HTTP body 或 SSE wire，wire codec 属于第三方 Provider package；
- 不决定 attempt 次数、退避或 fallback model，这些属于 Linnkit retry 与 Host routing policy；
- 不生成 Host UI 文案，也不维护 Provider 产品目录；
- 不按 URL、模型名或厂商名猜测错误语义。

新增 AI SDK 解码后错误形状时，只修改本 feature、对应 conformance fixture 和本 README。若需要同步修改 Linnkit、Host UI 或 Model Catalog，必须先复核边界是否泄漏。

Stream 失败必须先区分 owner：`AiSdkHostStreamInvariantError` 表示 Host 已经证明的 part 状态机违规，固定不可重试；普通上游 async stream rejection 没有这种证明，投影为可重试 transport failure。AI SDK timeout abort 的用户取消判别属于相邻 `stream-reliability` feature，不允许在这里通过错误 message 猜 timeout。

`AiSdkToolCallError` 表示模型产出的工具调用无法进入 canonical 完成态，不是流生命周期违规。
只按 SDK 正式 `InvalidToolInputError` / `NoSuchToolError` 类型及 canonical JSON object
合同分类：坏参数为可重试 `provider_tool_arguments_invalid`，其余 invalid call 为不可重试
`provider_tool_call_invalid`。Host 执行的 `NoSuchToolError` 不证明 Provider 失败；仅当参数
满足 canonical object 合同时，保留原始调用交 Host 检查范围和注册表。Adapter 按 call ID +
工具名消费一次 SDK 自动 validation error，不消费 Provider 执行结果或无对应调用的错误。
不读取错误文案、不伪造参数或工具结果，不在 adapter 校验业务 schema。安全诊断只保留
有限 `invariant_code` 与触发失败的 `stream_part_type`，不保留工具名、参数、错误正文或 reasoning。

`APICallError` 的非成功 HTTP status 按本 feature 的稳定状态码规则决定重试；没有 status 时只接纳 AI SDK 明确给出的 `isRetryable`。可重试项投影为 `transport/provider_transport_error`，不得从 message 猜测网络故障。

HTTP 2xx 只证明请求已接纳，SDK 读取响应 body 失败时仍可能带 status200、`isRetryable=false`（SDK按状态码计算的默认值）。此时 TypeError 传输原因或 SDK 明确可重试信号投影为 `provider_response_read_error`；有类型的 schema/JSON 原因保留对应分类；未知成功响应处理失败为不可重试 `provider_response_invalid`。真实401/403等拒绝不会被内部 cause 覆盖。

响应结构与流不完整必须分开：

- `TypeValidationError` 仍是不可重试 `provider_response_schema_invalid`；仅在 Provider stream 且其已解码 `value.error` 是对象、带可识别的超时/限流/鉴权等信号时，复用正常 decoded error 分类。未知 envelope 的自报 retryable 不覆盖 schema 失败，也不从 validation message（包含整个响应）推断原因。
- `InvalidResponseDataError` 不等于 schema 校验。当前上游 compatible SDK 在缺 finish reason 时以 `data=undefined` 抛此类错误；流中无 data 按可重试 `provider_stream_truncated` 处理，不声称已定位超时或网络。携带具体无效数据、或发生在非 stream 阶段时保持不可重试 `provider_response_data_invalid`。
- 只使用 SDK 正式类型与已解码事实，不新增 body/SSE parser、模型/URL 特判或错误文案匹配。上游未来提供专门的流不完整错误类型时，优先替换无 data 的投影边界；SDK 升级必须重跑真实 codec 验收。

安全诊断分别记录 schema 与 invalid-data shape，并可补 `sdk_error_details`：是否有响应数据、底层异常类别、HTTP status 与 SDK 原始 retryable；不记录 data/value/cause 对象或文案。`attempt_observed.terminal_event_received` 表示 adapter 已产生 canonical 终态，不是“上游发了结束帧”的证明；必须在 yield 前登记，覆盖消费者收到终态即停止、异常和自然EOF路径。

Linnkit 0.38 起，已知 HTTP/decoded 429 与限流 finish reason 额外投影 `retry_category: rate_limit`，模型坏工具参数与 SDK 已取得但正文为空的响应投影 `output`。类别来自本 feature 已解码的事实，不靠框架猜 Provider code；原有安全错误码、是否可重试保持不变，次数和等待策略仍由 Host 与 Linnkit 决定。

已解码、无冲突 HTTP 状态的 `ECONNRESET` 显式归为 transport，保留原安全 `provider_stream_error` 与不可重试声明；不能因它带有结构化 code 就落入未知 Provider 类。原始错误文本不参与这条规则。
