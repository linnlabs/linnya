# Provider Model Discovery Adapter

本 adapter 负责已连接正式供应商的实时模型列表和模型资料读取，通过显式列表协议 policy 接入 OpenAI API、OpenCode Go、Kimi 开放平台（国际站与中国站）、Claude、DeepSeek 与 Ollama Cloud。公开入口为
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

OpenAI API、OpenCode Go 和 Kimi 开放平台共用 Bearer `/models` 列表协议；Claude 使用独立的 `x-api-key` / `anthropic-version` 认证头，按 `has_more`、`last_id` 完整读取分页。后页失败、重复 ID 或异常游标使整次查询失败，不能发布半份列表。列表协议由 Provider Catalog 的唯一 admission policy 显式声明，Host 通过 `@linnya/provider-catalog/runtime-bindings` 的 `getProviderModelDiscoveryPolicy` 读取，不从推理 route、URL 或模型名猜测。

共享列表通过 Model Catalog 公开的 `ModelDiscoveryService.listIdentities` 复用既有鉴权、分页、超时与安全错误处理；该窄合同不执行 Custom API 的容量推断。共享列表响应只确认模型 ID；已知 ID 使用同连接 bundled 资料，单协议连接的未知 ID 联网读取 models.dev 并按精确 ID 补容量与能力。缺少资料或工具能力未确认时仍显示候选并说明原因。OpenCode Go 是多协议产品，未知 ID 必须等待发布目录审查协议，因此不读取未经审核的远端 binding，也不使用默认 Chat route。

官方工具能力不能被 models.dev 缺失的工具标记否定；Ollama 的 tools 事实来自 `/api/show`，共享 ID 列表本身没有这种能力声明，所以仍须明确的工具资料才能准入。

官方 membership、上下文与能力优先于补充资料；未知或容量不一致的模型保留为有原因的 unavailable 候选。远端列表和资料读取全部成功后才原子返回，不修改已有快照；网络、鉴权、响应格式或 metadata 准入失败均抛
`ProviderModelDiscoveryError`，消息不包含响应正文、URL 或密钥。共享列表的完整分页使用同一个 15 秒期限，详情与元数据请求各有 15 秒期限，均覆盖 headers 和响应体；调用方取消返回 499，失败会取消同批未结束请求。

Host 的 live candidate
owner、picker 和 activation 必须消费同一份结果。刷新不自动激活、删除或迁移模型；新模型仍沿正式 Provider
onboarding、已验收 binding 与 durable intent 注册。

资料合同：[OpenAI `/models`](https://developers.openai.com/api/reference/resources/models/methods/list)、
[OpenCode Go Models](https://opencode.ai/docs/go/#models)、
[Kimi Models](https://platform.moonshot.ai/docs/api-reference#list-models)、
[Claude `/models`](https://platform.claude.com/docs/en/api/models/list)、
[DeepSeek `/models`](https://api-docs.deepseek.com/api/list-models/)、
[Ollama `/api/tags`](https://docs.ollama.com/api/tags)、
[Ollama `/api/show`](https://docs.ollama.com/api-reference/show-model-details)。

业务验证运行相邻
`orchestration/createProviderModelDiscovery.test.ts`：覆盖真实新 ID、资料缺失、模态和工具准入、跨来源凭据隔离、并发上限、完整响应体超时及取消，不调用推理模型。
