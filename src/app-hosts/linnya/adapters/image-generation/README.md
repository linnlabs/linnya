# Image Generation Host Adapter

这里是 Linnya Host 对 `ImageGenerationPort` 的唯一 Provider 实现边界。Model
Catalog 提供已准入的 `image_generation_route`、模型约束和 credential
reference；本模块通过共享 model-request-auth 解析本次凭据，选择唯一 AI SDK
capability、写安全 outbound diagnostics，并把结果投影为 Provider-neutral 图片字节。

## 负责与不负责

负责：

- 校验模型、typed route 与 bearer credential，并透传 credential
  owner 的附属身份头；
- 在 Provider 调用前执行 domain 尺寸 preflight；
- 使用 `@ai-sdk/openai-compatible` image model 和 AI SDK `generateImage`；
- 固定 `maxRetries: 0`，按 route 的 `max_images_per_call`
  执行用户明确请求的批次；
- 强制 `b64_json`，把 AI SDK `GeneratedFile` 投影为字节；
- 写入不含 prompt、credential、base URL、Provider body 的安全诊断快照；
- 把 SDK/transport 错误收敛为稳定 Image Generation failure。

不负责：

- 模型用途选择、Agent 重试/降级或工具参数展示；
- 图片 MIME/尺寸的最终媒体识别、文件命名和落盘；
- Assets claim、conversation locator 或 Renderer metadata；
- ASR、Embedding、Reranking 或 Language capability。

## Provider 接入规则

当前 capability 是严格 OpenAI-compatible `/images/generations`
surface。`endpoint_id` 作为本次 AI SDK 实例的 endpoint
identity，但不允许反向决定 capability；Provider 原生 `2K/4K` 尺寸通过 provider
options 进入 SDK codec，`WxH` 使用 AI SDK 标准 size。响应必须是
`b64_json`，不接受 URL 回退。

图片 adapter 不直接调用
`ModelCatalog.resolveCredential()`。环境变量、加密 secret、Linnya
Cloud 设备身份和 Provider account OAuth 都由共享的
`ModelRequestCredentialResolver` 解析。ChatGPT 账号图片请求会携带 bearer、
`chatgpt-account-id` 和 `originator`；Responses 专属 `OpenAI-Beta`
不属于账号身份，因此不会进入图片请求。

新增 Provider 时优先增加官方 AI SDK Provider
package 或新的窄 capability。若 Provider 请求长期要求删除/重写 SDK
body 字段、接管响应 codec 或维护厚 middleware，说明它不属于当前 surface；不得把补丁塞进通用 capability。

## 测试门禁

受控 HTTP 测试必须覆盖 endpoint、认证、请求体、原生尺寸、`n`
拆分、返回字节、单 attempt 零重试和错误脱敏。Port 测试必须覆盖 route/credential、尺寸准入、结果不变量和安全诊断。真实密钥 smoke 是部署补充验证，不替代离线 conformance。
