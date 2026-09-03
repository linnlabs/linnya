# AI SDK Failure Projection

本 feature 是 AI SDK 已解码失败到 Linnkit canonical failure 的唯一投影边界。

## 职责

- 读取 AI SDK `APICallError`、SDK error class、decoded stream error 与 finish reason；
- 输出稳定的 `{ kind, code, retryable }` 或 canonical terminal event；
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

`APICallError` 已带 HTTP status 时，重试语义由本 feature 的稳定状态码规则决定；没有 status 时表示尚未取得 HTTP response，此时只接纳 AI SDK 明确给出的 `isRetryable`。可重试项投影为 `transport/provider_transport_error`，不得因缺少 status 降级成不可重试的通用 Provider 错误，也不得从 message 猜测网络故障。
