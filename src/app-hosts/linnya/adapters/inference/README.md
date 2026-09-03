# Inference Adapter

这里是 Linnya Host 对 canonical inference
port 的实现边界。它只负责一次 attempt 的显式 route
admission、capability 选择、凭据解析与事件身份校验，不执行工具、不决定模型重试/切换、不发布 Graph/Run 终态，也不保存 Provider
body。

## 目录与 owner

- `definitions/`：Host 内部的窄 route、credential 与 capability 合同；安全审计合同属于 audit
  domain。
- `functions/`：route admission、事件 route
  identity 校验和 metadata-only 安全投影。
- `orchestration/`：按 Model Catalog 的 `capability_id`
  选择唯一 capability，并形成 `CanonicalInferencePort`。
- `registry/`：API surface
  capability 注册表。它不是模型目录，不读取模型名或 URL 猜路由。
- `@linnya/provider-catalog/runtime-bindings`：严格读取与 public
  catalog 同 generation/digest 的 Host-only manifest；onboarding、factory
  admission 与 live/readiness 均从这个 package 入口投影。
- `features/provider-onboarding-binding/`：从正式 runtime
  manifest 投影 workflow 所需的默认 route/base/auth 与显式模型 route 覆盖，不再次读取或解析生成资产。
- `capabilities/ai-sdk/features/runtime-manifest-admission/`：Host
  composition 对 Catalog runtime binding 与 AI SDK factory
  descriptor 做完整性核对；它不拥有 manifest，也不选择目录产品。
- [`@linnlabs/linnkit-provider-ai-sdk`](../../../../../packages/linnkit-provider-ai-sdk/README.md)：AI
  SDK language request/event projector、factory registry、stream
  reliability、failure/usage/continuation 和 conformance 的唯一 owner。
- `features/ai-sdk-language-composition/`：把 Linnya resolved
  route/credential 投影到 package 窄合同，并在 Host seam 核对 Catalog
  binding 与 factory coverage。
- `features/provider-failure-policy/`：只注入 Linnya
  Cloud 等产品级错误语义；通用 AI SDK taxonomy 留在 package。
- `features/ai-sdk-diagnostic-logging/`：把 package 已脱敏的诊断事件写入 Linnya
  Logger；package 不反向依赖日志实现。
- `capabilities/ai-sdk/`：首版拆包后只保留 Embedding、Reranking 和 runtime-manifest
  admission。Language 生产执行不得回流到该目录。
- `capabilities/mock/`：`mock://` 脚本、严格配置解析、确定性工具参数和 canonical
  event 编排；只用于显式 mock route。
- `orchestration/createEmbeddingPort.ts`：从 Model Catalog 解析显式 embedding
  route/凭据，调用唯一 AI SDK embedding capability，校验向量合同并投影安全错误。
- `orchestration/createRerankingPort.ts`：从 Model Catalog 解析显式 reranking
  route/凭据，调用唯一 AI SDK Cohere-compatible
  capability，校验原文档索引并投影安全错误。

## 生产状态

Vercel AI SDK 7 已进入正式 Agent 生产主链。`createDefaultHostInferencePort()`
是 composition root：Model Catalog 解析显式 route/credential reference，Host
credential boundary 解析 attempt-scoped secret 与附属认证头，canonical
port 完成 admission 后再按 `capability_id` 进入
`@linnlabs/linnkit-provider-ai-sdk`。Language
inference 不读取 ModelConfig 的通用 header 字段。`LlmCaller` 只消费
`CanonicalInferencePort`；旧 `AgentAiEngine` port、callback stream、Host
language projector/factory 和生产 bridge 已删除。

账号身份头与语言协议头分属两个 owner：model-request-auth 只提供
`chatgpt-account-id`、`originator` 等 credential-scoped identity；Host 根据
`chatgpt_codex_responses` route profile 注入 `OpenAI-Beta`。因此同一 ChatGPT
OAuth 可以复用于模型发现和图片生成，而不会把 Responses 协议细节带到其它 API。

### 上游优先的实现规则

Host inference 的默认决策是复用现有 Vercel AI SDK Core、官方 Provider
package 或经过审核的 AI
SDK-compatible 开源 package，尽量不让 Linnya 承担模型快速迭代带来的 wire
protocol 维护。新模型若能由已有 capability 和 route 处理，只更新 Catalog/准入/conformance；Host 不新增模型名判断、厂商请求体、SSE
parser 或重复 Provider wrapper。

只有 adapter
owner 已记录上游候选、可复现缺口、许可证、最小维护边界和退出条件后，Host
composition 才能接纳新的本地 capability。上游 package 补齐能力后，应优先迁回 package 并删除本地实现，而不是长期保留双路由或兼容 fallback。完整规则由
[`@linnlabs/linnkit-provider-ai-sdk`](../../../../../packages/linnkit-provider-ai-sdk/README.md)
持有，Catalog 的上游数据复用规则由
[`@linnya/provider-catalog`](../../../../../packages/provider-catalog/README.md)
持有。

当前正式 language capability profile 包含 OpenAI Chat、通用 OpenAI-compatible
Chat、OpenAI Responses、Anthropic Messages、Google Generative AI、DeepSeek
Chat、MiniMax Chat、Moonshot/Kimi Chat、Alibaba/Qwen Chat、Mistral Chat、xAI
Responses、Groq Chat、Cerebras Chat、OpenRouter Chat、Fireworks Chat、Together
AI Chat、DeepInfra Chat、Cohere Chat 与 Z.AI Chat。它们统一使用 attempt-scoped
credential/base URL/headers、canonical message/tool mapper 和分 surface raw
usage projector。存在专用 package 的正式厂商不能借用通用 compatible
factory；SiliconFlow 国际站/中国站、NVIDIA NIM 与 ModelScope 经 package
inventory 和同类 Agent 交叉验证后共享
`@ai-sdk/openai-compatible`。Z.AI/智谱改用官方
`@ai-sdk/zai`，不保留 compatible 双路由；Moonshot 国际站、中国站与 Kimi
Code 共享经过独立 base URL/两轮回放验证的 Moonshot
capability，但各自仍是不同 connection 和 credential boundary。明确的 Custom
API 与 Ollama
route 使用通用 capability。OpenRouter 的官方 package 由 OpenRouter 发布，不属于
`@ai-sdk/*`
命名空间，但仍受同一 registry、版本、NOTICE 与 conformance 门禁约束。

Adapter package 的 factory registry 以 `capability_id`
为唯一索引，同时校验 surface 与 auth profile；`endpoint_id`
只表示当前下一跳，不能选择 codec。Host 解析 attempt
route 时还必须保留 endpoint 明确声明的
`route_profile_id`：同一 package/surface 可以服务普通 OpenAI
Responses 与 ChatGPT
Codex，但两种产品请求合同不能因共用 factory 而被抹平。Host 启动时把正式 runtime
manifest 的每条 route 与 package
registry 做完整性核对，缺失、重复或 surface/auth 漂移都会直接失败。业务代码只依赖 Host
composition 出口，不出现具体 factory 或厂商 body/SSE 逻辑。

Electron 主进程通过 CommonJS 加载后端 bundle，因此 adapter package 自身、AI SDK
Core 与全部 language Provider
dependency 必须在构建期内联完成 ESM→CJS 转换。`backend-ai-sdk-runtime-guard`
显式识别 adapter package，并从 package registry 的 `package_name` 元数据识别非
`@ai-sdk/*` 第三方 package，拒绝任何残留的运行时
`require()`；新增 package 时必须同时通过 backend bundle、NOTICE 和 packed
CJS/ESM 门禁，不能依赖开发机的 workspace alias。

Provider 产品和模型资料由独立
[`@linnya/provider-catalog`](../../../../../packages/provider-catalog/README.md)
拥有。其公开生成资产只供设置体验，Host 私有 binding 只描述“正式 Provider
onboarding 应创建哪条已验收 route”；二者都不能替代本 registry 的真实 package
factory。models.dev 的 npm/API 观察值只服务同步 diff，不参与运行时路由。

OpenCode
Go 验证了“一个 Provider 不等于一套 wire 协议”：同一套餐 Key 下，模型分别使用现有
`@ai-sdk/openai-compatible`、`@ai-sdk/openai` Responses 与 `@ai-sdk/anthropic`
factory。模型级 binding 只选择已存在的 route
profile；它不创建厂商 body/SSE 分支，也不让 Renderer 选择协议。

正式 profile 均通过真实第三方 SDK
codec 的受控流式 fixture；Chat 额外锁住图片、工具增量、usage
provenance、零 SDK 重试、headers 和单 fetch。DeepSeek、MiniMax、Moonshot、Alibaba 与 Z.AI 还有独立 package
factory 身份和两轮工具回放门禁，防止以后被误挂回通用 compatible codec。Kimi
Code 与 GLM Coding Plan 还分别锁住专属 base
URL 的请求投影；这只证明离线 codec，不替代真实 Key、打包 Agent、资格与 stable
graduation 门禁。

Dedicated Provider 两轮 conformance 共用 adapter package
`conformance/fixtures/dedicatedProviderCodecFixture.ts`
的 canonical 请求、流收集、持久化回放和第二轮请求 harness；各 Provider 或同 codec 家族使用
`conformance/providers/`
下的独立测试文件，禁止再把新厂商案例追加到单一巨型 fixture。共享 harness 只组织 canonical
round-trip，不包含厂商 body 分支；厂商响应与断言留在对应 Provider 测试中。

Together AI 与 DeepInfra 各自经过官方 wrapper 的 Chat Completions
codec；DeepInfra fixture 额外锁住其官方 package 对部分 Gemini/Gemma reasoning
usage 的修正。Cohere 使用原生 V2 `/chat`
codec，thinking 不携带跨轮签名，因此只由 canonical ordered
history 回放 reasoning、tool call 和 tool result，不新增 opaque continuation。

正式 compatible Provider 共用
`compatibleProviderCodecs.integration.test.ts`：同一第三方 codec 分别用五条真实默认 URL 验证 bearer
auth、reasoning、工具调用、usage 和第二轮 `reasoning_content`
回放。测试只为每个产品提供 route 数据，不增加 Provider body/SSE 分支。

工具结果图片只能进入第三方 package 原生支持的 surface。OpenAI 和 xAI 使用 Responses 的
`function_call_output`
图片，Anthropic、Google 和 MiniMax 使用各自 package 的原生工具结果图片映射。Chat
Completions 只允许文本 tool message；Host 不改写 package request
body，也不把工具图片伪装成 user message。共享 route profile
registry 记录经过 conformance 验证的图片来源上限，route 不能声明超出对应第三方 codec 的
`input_support`。模型目录中的 `image_input` 只表达模型能否理解图片；注册边界把该语义能力分别与 profile 的
`user_image`、`tool_result_image` 相交。产品开关不因某一个来源缺失而被整体禁用，设置页只读展示两种来源的有效结果。
OpenAI-compatible Chat 可以接收用户图片但不能接收工具结果图片，这个差异不能通过 synthetic user message 抹平。

Canonical message 的顺序属于 Linnkit 合同。普通 route 的 AI SDK
capability 显式允许 `messages` 中的 system
message，不能擅自折叠。唯一例外是明确的 `chatgpt_codex_responses` profile：Codex
backend 按其客户端合同接收顶层 `instructions`，使用非 strict
tools、`reasoning.summary=auto`，并省略wire
`max_output_tokens`；Linnkit 仍保留并执行 canonical 输出预算 admission。该例外只由 route
profile 选择，不能按模型名、URL 或 Provider 错误猜测。工具配置由同一个 projector 成组产生：没有候选工具时同时省略
`tools` 和
`toolChoice`；有候选工具时才投影 schema 与选择策略，禁止把空工具对象配 `auto`
交给 AI SDK。

Provider
capability 的合并与逐 route 切换不等待 Apple 正式签名/公证或 Windows 安装器。Backend/Main
bundle 与 macOS arm64 packaged controlled Provider
fixture 已通过；`pnpm run test:inference:packaged:mac` 会生成隔离的 ad-hoc
`app.asar` fixture，从打包 bundle 加载生产 capability 并发出一次本机受控请求。旧
`src/infra/adapters/llm`、`src/integrations`、宽 `AIEngine`、`StreamProcessor`
和 Provider 自研 codec 已物理删除，boundary guard 禁止恢复。

正式 BYOK 发布前使用 `pnpm run test:inference:byok:live`
验证已启用的具体 target。target
membership、route、默认 URL 与认证方式全部从正式 runtime
manifest 自动投影，不再维护手写厂商表或 target union。`LINNYA_BYOK_TARGETS`
必须显式填写一个或多个 target，逗号分隔；当前可选值为
`openai-chat`、`openai-responses`、`chatgpt`、`opencode-go-openai-compatible-chat`、`opencode-go-openai-responses`、`opencode-go-anthropic-messages`、`anthropic`、`google`、`deepseek`、`minimax`、`moonshot`、`alibaba`、`mistral`、`xai`、`groq`、`cerebras`、`openrouter`、`fireworks`、`togetherai`、`deepinfra`、`cohere`、`siliconflow`、`siliconflow-cn`、`zai`、`nvidia`、`modelscope`，`all`
表示全部。脚本只要求当前所选 target 的专用变量，不再要求一次备齐所有厂商密钥。OpenCode
Go 的三个 target 共用
`LINNYA_BYOK_OPENCODE_GO_API_KEY`，但分别要求与 route 匹配的代表模型变量。`chatgpt`
目标中的 `API_KEY` 变量只是在独立测试进程中注入已取得的短期 bearer
token；产品运行时仍由 ProviderAccount 解析和刷新，不要求用户填写 API Key。

| target                               | 必需专用变量                                                                              | 可选 base URL 变量                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `openai-chat`                        | `LINNYA_BYOK_OPENAI_API_KEY`、`LINNYA_BYOK_OPENAI_CHAT_MODEL`                             | `LINNYA_BYOK_OPENAI_BASE_URL`         |
| `openai-responses`                   | `LINNYA_BYOK_OPENAI_API_KEY`、`LINNYA_BYOK_OPENAI_RESPONSES_MODEL`                        | `LINNYA_BYOK_OPENAI_BASE_URL`         |
| `chatgpt`                            | `LINNYA_BYOK_CHATGPT_API_KEY`、`LINNYA_BYOK_CHATGPT_MODEL`                                | `LINNYA_BYOK_CHATGPT_BASE_URL`        |
| `opencode-go-openai-compatible-chat` | `LINNYA_BYOK_OPENCODE_GO_API_KEY`、`LINNYA_BYOK_OPENCODE_GO_OPENAI_COMPATIBLE_CHAT_MODEL` | `LINNYA_BYOK_OPENCODE_GO_BASE_URL`    |
| `opencode-go-openai-responses`       | `LINNYA_BYOK_OPENCODE_GO_API_KEY`、`LINNYA_BYOK_OPENCODE_GO_OPENAI_RESPONSES_MODEL`       | `LINNYA_BYOK_OPENCODE_GO_BASE_URL`    |
| `opencode-go-anthropic-messages`     | `LINNYA_BYOK_OPENCODE_GO_API_KEY`、`LINNYA_BYOK_OPENCODE_GO_ANTHROPIC_MESSAGES_MODEL`     | `LINNYA_BYOK_OPENCODE_GO_BASE_URL`    |
| `anthropic`                          | `LINNYA_BYOK_ANTHROPIC_API_KEY`、`LINNYA_BYOK_ANTHROPIC_MODEL`                            | `LINNYA_BYOK_ANTHROPIC_BASE_URL`      |
| `google`                             | `LINNYA_BYOK_GOOGLE_API_KEY`、`LINNYA_BYOK_GOOGLE_MODEL`                                  | `LINNYA_BYOK_GOOGLE_BASE_URL`         |
| `deepseek`                           | `LINNYA_BYOK_DEEPSEEK_API_KEY`、`LINNYA_BYOK_DEEPSEEK_MODEL`                              | `LINNYA_BYOK_DEEPSEEK_BASE_URL`       |
| `minimax`                            | `LINNYA_BYOK_MINIMAX_API_KEY`、`LINNYA_BYOK_MINIMAX_MODEL`                                | `LINNYA_BYOK_MINIMAX_BASE_URL`        |
| `moonshot`                           | `LINNYA_BYOK_MOONSHOT_API_KEY`、`LINNYA_BYOK_MOONSHOT_MODEL`                              | `LINNYA_BYOK_MOONSHOT_BASE_URL`       |
| `alibaba`                            | `LINNYA_BYOK_ALIBABA_API_KEY`、`LINNYA_BYOK_ALIBABA_MODEL`                                | `LINNYA_BYOK_ALIBABA_BASE_URL`        |
| `mistral`                            | `LINNYA_BYOK_MISTRAL_API_KEY`、`LINNYA_BYOK_MISTRAL_MODEL`                                | `LINNYA_BYOK_MISTRAL_BASE_URL`        |
| `xai`                                | `LINNYA_BYOK_XAI_API_KEY`、`LINNYA_BYOK_XAI_MODEL`                                        | `LINNYA_BYOK_XAI_BASE_URL`            |
| `groq`                               | `LINNYA_BYOK_GROQ_API_KEY`、`LINNYA_BYOK_GROQ_MODEL`                                      | `LINNYA_BYOK_GROQ_BASE_URL`           |
| `cerebras`                           | `LINNYA_BYOK_CEREBRAS_API_KEY`、`LINNYA_BYOK_CEREBRAS_MODEL`                              | `LINNYA_BYOK_CEREBRAS_BASE_URL`       |
| `openrouter`                         | `LINNYA_BYOK_OPENROUTER_API_KEY`、`LINNYA_BYOK_OPENROUTER_MODEL`                          | `LINNYA_BYOK_OPENROUTER_BASE_URL`     |
| `fireworks`                          | `LINNYA_BYOK_FIREWORKS_API_KEY`、`LINNYA_BYOK_FIREWORKS_MODEL`                            | `LINNYA_BYOK_FIREWORKS_BASE_URL`      |
| `togetherai`                         | `LINNYA_BYOK_TOGETHERAI_API_KEY`、`LINNYA_BYOK_TOGETHERAI_MODEL`                          | `LINNYA_BYOK_TOGETHERAI_BASE_URL`     |
| `deepinfra`                          | `LINNYA_BYOK_DEEPINFRA_API_KEY`、`LINNYA_BYOK_DEEPINFRA_MODEL`                            | `LINNYA_BYOK_DEEPINFRA_BASE_URL`      |
| `cohere`                             | `LINNYA_BYOK_COHERE_API_KEY`、`LINNYA_BYOK_COHERE_MODEL`                                  | `LINNYA_BYOK_COHERE_BASE_URL`         |
| `siliconflow`                        | `LINNYA_BYOK_SILICONFLOW_API_KEY`、`LINNYA_BYOK_SILICONFLOW_MODEL`                        | `LINNYA_BYOK_SILICONFLOW_BASE_URL`    |
| `siliconflow-cn`                     | `LINNYA_BYOK_SILICONFLOW_CN_API_KEY`、`LINNYA_BYOK_SILICONFLOW_CN_MODEL`                  | `LINNYA_BYOK_SILICONFLOW_CN_BASE_URL` |
| `zai`                                | `LINNYA_BYOK_ZAI_API_KEY`、`LINNYA_BYOK_ZAI_MODEL`                                        | `LINNYA_BYOK_ZAI_BASE_URL`            |
| `nvidia`                             | `LINNYA_BYOK_NVIDIA_API_KEY`、`LINNYA_BYOK_NVIDIA_MODEL`                                  | `LINNYA_BYOK_NVIDIA_BASE_URL`         |
| `modelscope`                         | `LINNYA_BYOK_MODELSCOPE_API_KEY`、`LINNYA_BYOK_MODELSCOPE_MODEL`                          | `LINNYA_BYOK_MODELSCOPE_BASE_URL`     |

每个 target 强制执行“命名工具调用 → 工具结果 follow-up”两轮，要求两轮都有 Provider
usage、第二轮有正文，并断言真实 Provider request count 恰好为 2。该脚本只接受
`LINNYA_BYOK_*`
专用变量，防止误用开发机日常密钥；缺失配置时只报告变量名，不输出已配置的密钥。新 Provider 不能只注册 factory 就宣称 BYOK 完成；catalog
admission 会自动让它进入 target/readiness 投影，但仍必须补齐离线编排测试和真实模型执行记录。

非 Agent 文本调用只能依赖 `domains/model-inference` 暴露的窄能力合同。当前
`text-generation` 由 `createTextGenerationPort()` 投影到同一条 Host canonical
inference 路由；它不暴露工具执行、Provider SDK、OpenAI 形状响应或旧
`AIEngine`，也不拥有重试、降级和业务提示词。图片生成使用独立的
`domains/image-generation` 与
[`adapters/image-generation`](../image-generation/README.md)，不能借用文本合同；图片/PDF 视觉理解仍属于这里的 Text
Generation consumer。

`embedding` 由 `createEmbeddingPort()` 直接进入 `@ai-sdk/openai-compatible`
的 embedding model，不借用 language event 或 chat
continuation。每次 capability 调用固定
`maxRetries: 0`，默认单并发；业务 owner 可显式给出并发上限。Provider 响应 body 只在调用内存中用于 codec 和 raw
usage 投影，错误只向外暴露分类/code/retryable，不返回 request/response body。

`reranking` 由 `createRerankingPort()` 直接进入 `@ai-sdk/cohere`
的 Cohere-compatible reranking model。当前默认 SiliconFlow route 只提供 base
URL、provider model 与 bearer
credential；Host 不读取模型名或 URL 猜协议。调用固定 `maxRetries: 0`，响应只投影
`originalIndex + score` 和实际 Provider `meta` usage。

Durable Assistant 以 `assistant_replay_parts`
保存 text/reasoning/tool 的统一顺序。AI SDK
capability 在 part 开始时分配跨类型全局
`part_index`，Linnkit 按索引持久化；不能按 part 结束顺序或 Provider 经验排序。带工具调用的流式正文封口不进入第二条 Context 消息，完整 Assistant
turn 由 `tool_call_decision` 的 ordered parts 唯一重建。

Continuation 已采用不兼容升级：每项包含完整 producer route
identity，并且必须绑定到 `assistant_replay_parts`
的具体 part。数据库 v58 删除旧匿名 `reasoning_details`，v59 删除缺少 ordered
parts 的聚合 continuation，不使用当前模型或常见 Provider 顺序猜测回填。Host
响应 projector 绑定本次 route；请求 projector 只消费 producer 与 active route
完全一致的 continuation，切换模型时跳过其他 route 的 opaque sidecar 并保留
canonical 历史。同 route continuation 的 target 和 tool call identity
仍须严格一致；required
route 缺失有序 tool continuation 时直接拒绝结构化工具回放。

OpenAI Responses、xAI Responses、Anthropic Messages、Google Generative
AI、DeepSeek、MiniMax、Moonshot、Alibaba、Mistral、Groq、Cerebras、OpenRouter、Fireworks、Together
AI、DeepInfra、Cohere 以及五个正式 compatible Provider 均有两轮第三方 codec
conformance：第一轮 Provider 响应先投影并模拟持久化为 canonical replay
parts，第二轮再由同一正式请求 projector 和 SDK
codec 生成真实 Provider 请求体。OpenAI 与 xAI 分别按各自 Provider metadata
namespace 回放完整 reasoning/function items；Anthropic/MiniMax 回放 thinking
signature；Google 回放
`thoughtSignature`；DeepSeek/Moonshot/Mistral/Groq/Fireworks/Together
AI/DeepInfra 与 compatible cohort 回放 reasoning；Cohere 按 V2 message/tool
wire 回放 canonical history；Cerebras 官方 package 把通用 codec 产生的
`reasoning_content` 转换为其要求的
`reasoning`；OpenRouter 只回放官方 package 定义的 signed `reasoning_details`
字段并丢弃未知 metadata；Alibaba 按其官方 package 合同丢弃不可回放 reasoning、保留工具调用与结果。只验证单轮 fixture、只测自研 projector 或只看到 HTTP
200 都不能替代这些门禁。

Linnkit 已经拥有 durable history，因此 OpenAI 与 xAI
Responses 固定使用各自 package namespace 的
`store=false`，不能同时依赖 Provider 服务端会话存储。AI SDK
package 必须从 canonical ordered parts 与 opaque
continuation 重建完整的 reasoning、assistant、function call 和 function output
item；不能把历史压成要求下一跳保存会话状态的
`item_reference`。这条规则同时适用于 OpenAI 官方 endpoint 和 Responses-compatible 自定义网关，禁止按 URL 特判。

## 安全与可观察性

`createHostCanonicalInferencePort()` 在真实 capability 边界向
`ProviderOutboundAuditPort` 写入 `started`
和唯一终态；Embedding、Reranking 与独立 Image Generation Host
adapter 也在各自窄 port 写入同一合同。`projectInferenceAttemptAudit()`
只产出 route
identity、消息角色计数、工具数量和图片 MIME 聚合。usage 只保留 provenance 与安全 token 聚合，不保存 raw。prompt、answer、tool
schema/arguments、图片 bytes、API key、base
URL、headers、路径、资源身份、continuation payload 与 Provider error
body 都不能进入快照。完整 Provider
payload 只允许存在于 capability 调用内存和离线 conformance fixture。

调试读取方统一使用 audit domain 的只读 snapshot port。旧 `LLMHttpClient`
request-debug store 与无生产写入者的 run-audit
HTTP 快照分支均已删除，不得为新 capability 恢复第二份 Provider 请求快照。

AI SDK Core 的默认错误处理会打印包含 request/response body 的
`APICallError`。Adapter package 的正式 capability 必须显式接管
`onError`，只返回脱敏后的 canonical failure；Host 的 diagnostic
sink 也只能读取 package 白名单事实，不得记录 SDK error、stack、response
body 或请求参数。

错误投影必须保留故障阶段，但不能保留 Provider 正文。HTTP status 使用
`provider_http_*`；流式结构化错误区分限流、上游不可用、超时和普通 stream
error；SDK schema、JSON、空响应、本地 request
projection 与 stream 生命周期各有稳定 code。重试只读取 status 或结构化
`type/code`，不读取或记录 `message`，因此日志、run event 与 outbound
audit 能定位故障层级，同时不会泄漏 prompt、响应正文或 credential。

可触发产品切模的 failure code 由 adapter package 定义，Host 的
`definitions/modelRoutableInferenceFailure.ts` 只投影为相邻 routing
policy 可消费的窄合同。Routing policy 不得 deep import package failure
feature、复制 code 字符串或解析错误正文。新增 AI
SDK 解码后错误形状应局部修改 package `failure-projection` 与 conformance
fixture；Linnya Cloud 等产品错误只修改 Host
`provider-failure-policy`，不能要求 Linnkit、Renderer 或 Model Catalog 理解 SDK
shape。

OpenAI Responses 在已经产生输出后仍可能以 SDK 解码后的嵌套 `response.failed`
结束。Adapter
package 必须从该结构的安全判别字段区分限流、上游不可用、超时与请求错误，并保持 Provider 的可重试语义；不得把这种 Provider 终态误报为 Linnkit
stream 生命周期损坏，也不得把嵌套 message 写入日志或 canonical event。

AI SDK 的统一 `finishReason=other`
表示 Provider 的非标准结束语义，不等于协议解析失败。Adapter package 必须同时读取
`rawFinishReason`：Responses 兼容网关沿用的 `max_tokens` 窄别名投影为 canonical
`length`；限流、上游不可用和超时类原始原因投影为可重试 Provider
failure；未知原因也只能进入脱敏后的 `unrecognized`
诊断类别，不能把原始字符串写入 canonical event、日志或 outbound
audit。不得恢复“忽略 `response.incomplete`，看到 `[DONE]`
就按成功结束”的旧行为。

正式 language capability 通过 AI SDK 原生 `firstChunkMs/chunkMs`
把连续无内容分片上限统一设为 5 分钟；该值由 Host
composition 注入 package，不属于 Provider、模型或用户配置。SDK timeout
abort 在用户 signal 未取消时形成可重试
`provider_stream_idle_timeout`，未知上游 stream
rejection 和 terminal 前 EOF 也属于可重试 transport
failure；用户取消仍是不可重试
`request_aborted`。只有 adapter 自己检测到的确定性 part 状态机违规才是不可重试
`provider_stream_lifecycle_invalid`。Linnkit 继续独占 attempt 次数与退避，并在已有部分输出的失败 attempt 重试前发送
`stream_reset`；Host 不据此切换模型，也不把失败 attempt 写成 durable Assistant
turn。

## 相邻模块边界

- `adapters/model-routing-policy/` 只把 `llm.<canonical failure code>` 映射为
  `switch_model/none`，不读取 Provider
  body、不选择具体备用模型，也不拥有 retry 预算。
- `adapters/llm-input-materialization/`
  拥有图片等资源的 route-aware 物化；本模块只接收已通过 preflight 的 canonical
  bytes。
- `adapters/token-accounting/`
  拥有发送前计数与 cost 聚合；本模块只投影单次 Provider response 的 raw usage
  provenance。
- `domains/model-inference/features/*`
  拥有非 Agent 文本、Embedding、Reranking 业务合同；Host
  capability 不能让这些调用方依赖 AI SDK 类型。

## 修改门禁

新增或修改 language capability 必须在 `@linnlabs/linnkit-provider-ai-sdk`
内覆盖凭据/headers、单次 fetch、`maxRetries: 0`、Abort、错误脱敏、ordered
tool/assistant parts、continuation identity 和 raw usage 有/无；Chat
projector 必须覆盖有序 system message、空工具 `auto` 和带工具
`auto`。对应 Provider 的 request/SSE 断言必须留在 package
conformance，禁止在 Host 补厂商 codec。

Host 变更必须覆盖严格 route admission、Catalog/factory
parity、credential 投影、产品 failure policy、脱敏 diagnostic 和安全 outbound
audit。Embedding/Reranking 继续运行各自 Host 业务测试；正式 mock 变更还必须运行
`capabilities/mock/__tests__`，禁止重新产生 OpenAI-shaped SSE 或非流式兼容响应。
