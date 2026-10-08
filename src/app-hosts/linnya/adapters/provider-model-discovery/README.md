# Provider Model Discovery Adapter

本 adapter 负责已连接正式供应商的实时模型列表和模型资料读取，目前只支持
`deepseek` 与 `ollama-cloud` connection。公开入口为
`index.ts`。Host 提供已验证的 connection、官方 base
URL 和当次凭据；本 adapter 不读取凭据文件、不建立 Provider 配置、不写入目录，也不选择推理 route。

DeepSeek 从官方 `/models`
一次读取完整列表，直接接纳名称、上下文、最大输出和输入/输出模态。该接口当前没有分页合同，不构造未定义的 cursor。完整资料缺失的新 ID 仍作为 unavailable 候选返回，不会套用其他模型的容量。工具能力来自已经验收的 DeepSeek
Chat
connection；具体 reasoning 档位仍由现有准入和 codec 合同决定，本 adapter 不扩大档位。

Ollama Cloud 从 `/api/tags` 获取真实成员集合，以最多四个并发 `/api/show`
请求读取上下文和能力。只有明确支持 completion、tools 且报告有效上下文的模型才继续准入。`/api/show`
未声明独立输出上限，因此优先使用同 ID 的 bundled 资料；存在未知模型时只读 models.dev，通过 Provider
Catalog 的 `projectLiveProviderModelMetadata`
使用已有 policy 补足资料。匹配严格限定 connection 和模型 ID，不猜别名、不从其他供应商借容量、不读取上游 runtime
binding。

当前补充资料继续遵循 Catalog 的 Agent 模型准入：如果 models.dev 尚未声明某个新 ID 的工具能力，
即使 Ollama 已报告 tools，该 ID 的补充容量也可能暂不可用。这时仍显示 unavailable 原因，
不绕过已有 policy；本次不扩展 Catalog metadata-only 的准入语义。

官方 membership、上下文与能力优先于补充资料；未知或容量不一致的模型保留为有原因的 unavailable 候选。远端列表和资料读取全部成功后才原子返回，不修改已有快照；网络、鉴权、响应格式或 metadata 准入失败均抛
`ProviderModelDiscoveryError`，消息不包含响应正文、URL 或密钥。每次 HTTP 请求的 15 秒期限覆盖 headers 和响应体；调用方取消返回 499，失败会取消同批未结束请求。

Host 的 live candidate
owner、picker 和 activation 必须消费同一份结果。刷新不自动激活、删除或迁移模型；新模型仍沿正式 Provider
onboarding、已验收 binding 与 durable intent 注册。

资料合同：[DeepSeek `/models`](https://api-docs.deepseek.com/api/list-models/)、
[Ollama `/api/tags`](https://docs.ollama.com/api/tags)、
[Ollama `/api/show`](https://docs.ollama.com/api-reference/show-model-details)。

业务验证运行相邻
`orchestration/createProviderModelDiscovery.test.ts`：覆盖真实新 ID、资料缺失、模态和工具准入、跨来源凭据隔离、并发上限、完整响应体超时及取消，不调用推理模型。
