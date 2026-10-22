# `@linnlabs/linnkit-provider-ai-sdk`

Linnkit 的可选 Vercel AI SDK Language Inference adapter。它把 Linnkit canonical
request 投影到经过审核的第三方 Provider
package，再把单次流式调用投影回 canonical
event；它不属于 Linnkit 内核，也不拥有任何 Host 的模型产品目录。

本 package 是 AI SDK language adapter 的唯一源码、依赖和 conformance
owner。消费它的 Host 负责把自己的 route、凭据和审计策略投影到公开合同；业务代码和 Linnkit 内核不直接接触具体 Provider
factory、request body 或 SSE。

## Owner 与非 Owner

本 package 拥有：

- canonical system、user、assistant、tool、图片、tool
  choice、sampling 与稳定前缀缓存提示到 AI SDK
  Core 的窄投影；当前只为正式声明支持的 Anthropic
  capability 下发显式断点，OpenAI 使用自动前缀缓存，其余 codec
  保持请求语义并忽略该提示；模型切换时只回放 active route 自己的 opaque
  continuation，canonical 历史保持不变；
- 以 `capability_id` 为唯一索引的 language factory
  registry，以及每个正式 Provider package 的精确版本；
- AI SDK
  stream 到有序 text、reasoning、tool、usage、continuation、finish 和 failure 的投影；
- single-step、`maxRetries: 0`、first/chunk idle
  timeout、未知断流与 terminal 生命周期；
- 脱敏 diagnostic 合同和可选的产品错误分类扩展点；
- 真实第三方 codec 的离线两轮 conformance，以及 packed CJS/ESM
  artifact 的两轮工具闭环。

错误规则集中在 [failure-projection](./src/features/failure-projection/README.md)：
复用 SDK 类型、HTTP/decoded error 与底层 cause，区分响应不完整、成功响应读取失败和真正的
schema/JSON 不兼容。SDK 的 `isRetryable` 不是每一种流错误的完整判据；adapter 只做安全分类，
实际次数、退避、取消及失败片段撤回继续交给 Linnkit，不叠加 SDK 自动重试。

本 package 明确不拥有：

- Provider 产品目录、stable/preview、模型资料、模型发现、onboarding 或设置 UI；
- 模型配置、endpoint 选择、API Key/OAuth 获取、刷新和持久化；
- Host 管理的配额、账号、订阅、日志文案、outbound diagnostics 或模型切换；
- Agent loop、上下文管理、工具执行、调用预算、retry/fallback 和 durable
  history；
- Embedding、Reranking、Image Generation、OCR 或 Transcription。

## 上游复用与维护成本原则

模型和供应商接口更新速度远高于 Linnya 的发布节奏，因此本 package 默认选择**复用上游，不自行维护协议实现**。目标不是拥有更多 Provider 代码，而是把长期跟进模型、请求格式、流式事件和兼容性变化的成本交给持续维护这些能力的开源项目。

新增或更新 capability 时必须按以下顺序评估：

1. 优先复用 Vercel AI SDK Core 已有的消息、工具、流、usage、错误和 Provider
   specification 能力；
2. 优先使用官方 `@ai-sdk/*` Provider
   package；官方没有时，才评估厂商或成熟开源项目维护的 AI SDK-compatible
   package，并完成版本、许可证、活跃度、NOTICE 和打包审计；
3. 上游 package 已支持新模型且 wire contract 未变时，只更新 Provider
   Catalog、准入资料和受影响 conformance，禁止因为模型名称变化新增 factory、route 或本地协议分支；
4. 本地代码只允许承担 canonical
   contract 与上游 package 之间的窄装配、准入和安全投影，禁止重复实现上游已经拥有的 request
   body、SSE parser、tool codec、usage parser 或模型枚举；
5. 只有确认没有可用 package、现有 package 存在已复现的关键缺口，并记录候选方案、缺口证据、维护边界和退出条件后，才允许引入最小本地实现或 copied
   source；上游补齐后应优先删除本地实现。

评审一个 Provider 变更时，首先要回答“能否通过升级或配置现有 package 完成”，而不是“在哪里再加一个厂商分支”。若答案是新增 Linnya 自维护 codec，Proposal 或变更说明必须明确证明为什么 Vercel
AI
SDK、厂商 package 和成熟开源实现都不能满足需求，以及由谁承担后续模型更新和协议漂移维护。

## 目录与修改地图

| 目标                                          | 唯一位置                                            | 约束                                                                                       |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| package-owned route、credential、factory 合同 | `src/definitions/`                                  | 只表达一次 attempt 所需事实，不出现产品 Provider 或 Catalog 类型                           |
| canonical request/message/tool/sampling 投影  | `src/functions/`                                    | 不按厂商名、模型名、URL 或错误文本分支                                                     |
| usage 与 continuation 投影                    | `src/functions/`                                    | 只消费 AI SDK 标准结果和白名单 metadata                                                    |
| failure taxonomy 与安全 observation           | `src/features/failure-projection/`                  | 不保存 Provider message/body；产品特例由 Host 注入窄 classifier                            |
| stream 空闲策略                               | `src/features/stream-reliability/`                  | 只配置 Core first/chunk timeout，不拥有 Linnkit retry 预算                                 |
| 单次 language stream 编排                     | `src/orchestration/`                                | 固定单 step、零 SDK retry，不执行工具                                                      |
| 具体第三方 package factory                    | `src/providers/<provider>/`                         | 一个正式 Provider/capability 一个局部模块；声明 factory、package identity、必要 options 与可选的 SDK 能力投影 |
| 全 capability 汇总与 admission                | `src/registry/`                                     | 只组合模块并校验 capability/surface/auth；不读取 Catalog                                   |
| 共享 codec harness                            | `conformance/fixtures/`                             | 组织两轮 canonical round-trip，不放厂商条件分支                                            |
| Provider/surface 业务验收                     | `conformance/providers/`                            | 每个 Provider 或共享 compatible cohort 独立证明真实 wire 行为                              |
| 生产与测试出口                                | `src/index.ts`、`conformance/index.ts`              | 生产不得导入 `./conformance`，consumer 不得 deep import 内部目录                           |
| 构建、声明与 packed runtime                   | `tsup.config.ts`、`scripts/verifyPackedRuntime.mjs` | CJS、ESM、DTS 与 tarball 内真实入口必须同时可运行                                          |

`providers/*`
是技术 capability 模块，不是新的产品 domain，也不是一厂商一个二次 wrapper
package。Vercel 或厂商 package 已经拥有 body/SSE
codec；本地模块只负责把 attempt-scoped `base_url`、model
ID、credential、headers 和 fetch 交给它。共享 canonical
projector 禁止复制到厂商模块。

## 公开出口

生产入口 `@linnlabs/linnkit-provider-ai-sdk` 只公开：

- `createAiSdkLanguageModelRegistry()`；
- `createAiSdkInferenceCapability()`；
- package-owned route、credential、diagnostic、failure
  extension 和 registry 类型；
- 稳定 capability ID 与可切模 failure code。

Registry 的 `resolveModelReasoning({ capability_id, endpoint_model_id })` 只查询本地 SDK
明确支持的 canonical 思考档位，不创建 Provider client、不读取凭据、不发网络请求。Host
可将结果接入自己的能力投影，但模型产品目录和持久化仍由 Host 拥有。

当前只有 Anthropic factory 提供该查询：`@ai-sdk/anthropic/internal` 的
`getModelCapabilities` 是精确锁定 SDK 版本的内部出口，依赖隔离在 Anthropic owner，升级时必须跑真实 codec
conformance。只接纳 `isKnownModel` 且支持 adaptive thinking 的结果，不复制模型版本清单；未识别、
非 adaptive 或其他 capability 返回 `undefined`，不能把缺少声明解释为明确不支持。
SDK 拒绝关闭思考时不公开 `off`，`between_tools` 也不等于关闭；`xhigh` 只在上游声明支持时公开，
不扩大 Linnkit 合同增加 `max`。SDK 没有提供默认档位事实，查询只返回支持档位，产品默认选择由 Host 决定。
旧版 extended thinking 没有可复用的正向能力标记，因此本查询不根据输出容量或 SDK 的未知模型默认值猜测。

测试入口 `@linnlabs/linnkit-provider-ai-sdk/conformance` 只公开受控 HTTP/SSE
harness 与 canonical projector 测试 seam。生产代码禁止导入该入口。具体 Provider
factory、AI SDK 原始 model、内部 failure observation 和厂商 metadata
reader 都不是公开 API。

## 依赖方向

允许的方向是：Host composition → 本 package →
`@linnlabs/linnkit/ports`、`@linnlabs/linnkit/contracts`、AI SDK
Core 和具体 Provider packages。

禁止的方向包括：

- 本 package → 任一 Host 的产品目录、应用 schema、UI、数据库、托管后端、Model
  Catalog 或 Logger；
- Linnkit core → 本 package、AI SDK 或任何 Provider 产品语义；
- Host 产品目录 → 本 package 或具体 AI SDK factory；
- Host 业务代码 → `src/providers/*` 或任一 language Provider package；
- production → `@linnlabs/linnkit-provider-ai-sdk/conformance`。

`@linnlabs/linnkit` 是显式 peer dependency，本 package 只使用公开 `/ports` 和
`/contracts`。当前 peer 为 `^0.38.0`，开发与 Host 装配使用同一精确版本，以消费已修复的正式声明产物。
`ai`、`@ai-sdk/provider`、全部 language Provider
package、OpenRouter 官方 package 和经过审核的 `ai-sdk-ollama` community package 是本
package 的精确直接依赖；根应用不再替它拥有这些版本。Embedding、Image
Generation 与 Reranking 仍可在各自 Host
adapter 中直接拥有所需依赖，这不属于 language adapter 的所有权。

## Host 装配

推荐装配顺序为：

1. Host 自己的产品目录提供已经审核的 route；
2. Host 解析当前模型配置、endpoint、credential 和产品策略；
3. Host 将 route/credential 显式投影为本 package 的窄输入；
4. Host composition 核对 runtime binding 与 factory
   registry 的 capability、surface 和 auth parity；
5. 本 package 完成一次 Provider 调用并返回 canonical events；
6. Linnkit 独立决定 retry/fallback、工具循环、上下文和持久化；Host 独立记录安全 audit。

失败投影可提供通用 `retry_category`：HTTP 429、已解码限流和限流结束原因标为
`rate_limit`，工具参数损坏标为`output`。原始安全code和retryable保留；该字段只解释失败性质，
不决定次数、等待或切模。Linnkit不猜供应商code；未提供类别的旧适配器仍沿既有通用分类。

Host 产品目录与 adapter 不能互相依赖。产品目录只描述 Host 允许什么 route；adapter 只描述某个技术 capability 如何通过第三方 package 执行；它们只能在 Host
composition seam 相遇。

Host 可以注入两类扩展，但不得借此污染通用 adapter：

- `AiSdkInferenceCapabilityInvocation.provider_failure_classifier`：把 Host 管理服务的
  错误候选映射到产品 failure code。Host按当前请求绑定规则，不在共享capability dependencies
  上安装全局产品分类器；adapter不接收产品身份，也不替Host解析连接归属；
- `diagnostic_sink`：消费 adapter 已白名单化的 attempt 请求形状、负载规模（含图片所在消息角色）、流终态、阶段、shape、Provider 的安全 `type/code/reason` 和 retryable 信息，并决定日志级别与文案。请求 fingerprint 只由安全的请求形状摘要计算，不包含 prompt、工具正文或图片字节。

diagnostic_sink只接收白名单投影，不能读取或返回prompt、response body、API key、headers、
base URL、路径或图片bytes。classifier的既有`candidate.response_body`仅供当前调用内存中的
产品分类，不得返回、记录或持久化；这不是通用日志/诊断扩展点。

工具调用的输入错误与流状态机违规分开分类。AI SDK 的 `dynamic/invalid`
不证明流损坏：无法解析或不是 JSON object 的参数形成可重试
`provider_tool_arguments_invalid`。仅由 Host 执行且参数为合法 object 的 `NoSuchToolError`
保留原始调用身份、工具名和参数，交 Host 工具 admission 产生配对拒绝结果供模型修正。
本次模型目录不是授权；Host Registry 在具体执行、decorator 和自身缓存前检查调用范围及注册表。
Linnkit ToolNode 的历史幂等复用属于另一边界；本合同不据此认证未来声明幂等策略的工具已获跨范围复用验证。
Adapter 不猜工具别名、不补工具定义、不执行调用、不增加重试；只消费与该调用身份匹配的
SDK 自动 `tool-error` 副本，其他工具结果仍拒绝。其他 SDK invalid call 保持不可重试
`provider_tool_call_invalid`。只有已证明的
part 生命周期违规使用 `provider_stream_lifecycle_invalid`。Adapter 不修复参数、
执行工具或产生工具错误结果；schema 字段校验仍由工具 owner 的正式 admission 执行，
重试次数和退避仍由 Linnkit 决定。

`failure_projected` 对本地投影失败保留有限枚举 `invariant_code` 和
`stream_part_type`；后者记录触发失败的分片类型。Adapter 在投影失败后会主动 abort
并排空上游流，因此 attempt 的 `last_provider_part_type=abort` 本身不能证明网络断流。
没有这些细分诊断的历史失败不能倒推到某一种 invariant。

## Provider 变更流程

升级一个已有 Provider package 时：

1. 只修改本 package manifest 中对应的精确版本；如果 factory API 改变，只修改对应
   `src/providers/<provider>/`；
2. 先用 `conformance:affected` 按 `--package` 或 `--capability`
   运行定向 conformance，核对 request
   codec、SSE/event、tool、reasoning、usage、continuation、认证和零 SDK retry；
3. 运行 package 全矩阵、typecheck、build 和 packed runtime smoke；
4. 在消费 Host 中运行 NOTICE、依赖边界、backend bundle 与集成门禁；
5. 有真实凭据时再做代表 route 的两轮 live/packaged 验收；不能用 HTTP
   200 代替 Agent 工具闭环。

新增正式 capability 还必须先证明第三方 package 的来源、许可证、AI SDK
specification 兼容性和真实协议能力。已有正式 package 时禁止挂到通用 compatible
factory；只有上游和同类实现都证明服务本身就是 OpenAI-compatible 时，才复用 compatible
capability。禁止新增本地 body builder、SSE
parser、按 URL/模型名猜协议或失败后切 codec 的 fallback。

Z.AI 是这条规则的现成案例：2026-08-26 发布的官方 `@ai-sdk/zai`
已通过独立两轮 conformance，因此 Z.AI route 使用 `zai_chat`；SiliconFlow、NVIDIA
NIM 与 ModelScope 等仍经单独准入的服务才继续共享 compatible
capability。Ollama Cloud 使用 `ai-sdk-ollama` 的原生 `/api/chat` codec；factory 显式关闭该
package 的可靠工具调用和对象生成重试，确保一个 canonical attempt 只产生一次 Provider
请求。该 package 还负责把 canonical 工具结果图片编码为原生 `tool message + images`；Host
只维护经 conformance 验证的 placement 能力，不复制图片编码。目录来源曾经观察到 compatible
package，不构成退回通用 codec 的理由。

模型目录更新不修改本 package factory；Provider
package 更新也不修改 Host 的模型资料、onboarding、Linnkit 或 Agent 语义。

### 上游升级边界

OpenAI-compatible 的工具图片使用 `@ai-sdk/openai-compatible` 自 `3.0.62` 提供的
`supportsMultiPartToolContent`，当前冻结版本为 `3.0.68`。只有 Host 已准入的
`AiSdkInferenceRoute.tool_result_image=true` 才向 factory 开启该选项；省略时保留上游默认行为和文本工具 wire。
Adapter 不按模型名或 URL 判定能力，不自行编码图片，也不插入额外 user message。
AI SDK 当前没有通用的图片角色能力发现接口，模型的视觉标记不能等同工具图片支持。
Host 负责提供经过真实 Provider 验收的角色事实；上游未来增加公开角色声明时应复核这层显式 opt-in。

DeepSeek 原生工具图片直接使用上游 codec：`@ai-sdk/deepseek` 已从 `3.0.50`
支持 tool content 图片块，当前依赖不再携带本地 patch 或修改声明。用户/工具图片、
跨轮 reasoning、非法图片拒绝、usage 与两轮回放继续由
`conformance/providers/deepSeekProviderCodec.integration.test.ts` 和 packed CJS/ESM smoke 验证。
Backend 构建仍内联经过冻结安装的 SDK，`guard:backend-ai-sdk-runtime` 禁止残留外部加载。
离线 codec 通过不替代 Host placement 准入和真实 Provider 图片验收。

2026-10-15 使用 Linnya CLI 与应用内已有的 DeepSeek 官方 `deepseek-flash` 配置完成真实验收：
三轮对话涵盖关闭推理的文本流、开启推理的 Shell → read_file 原生工具图片续轮、
跨用户轮次图片历史回放，共五次成功模型请求；usage 与两次工具审计完整。
回放曾遇到上游 HTTP 503，沿正式 CLI resume 恢复后成功；该结果不代表其他厂商已完成在线验收。

Google 暂时锁定在自动长输出续传之前的版本，具体版本以 manifest 为准。
上游 `4.0.95` 遇到 `CONTINUATION` 会在同一次模型调用中自动追加 HTTP 请求，
包括流式调用；`maxRetries: 0` 无法关闭该行为。后续升级前必须先明确单 attempt
请求边界、usage 聚合、取消和诊断合同，并补齐长输出验收，不能只刷新版本号。

xAI 只使用正式 Responses factory，不依赖上游已删除的 Chat Completions API。
Anthropic/MiniMax 禁用工具调用时由上游保留工具前缀并发送 `tool_choice: none`；
OpenAI Responses 的非严格工具显式编码为 `strict: false`；Qwen 的工具续轮由上游保留
reasoning。这些 wire 变化通过 conformance 接纳，不在 Host 重写请求体。

`conformance:affected` 支持重复传入 `--package <npm-name>` 和
`--capability <id>`；`--all` 选择全部 capability，`--list`
只输出脱敏选择结果而不执行。选择 `ai` 或 `@ai-sdk/provider`
会自动升级为全矩阵；选择 `@ai-sdk/openai`
会同时覆盖 Chat 和 Responses；选择 `ai-sdk-ollama` 只覆盖原生 Ollama Chat。该命令输出 conformance suite
version、受影响 capability、测试文件和 Provider package
version，不输出 URL、凭据或 fixture body。

## 测试与制品门禁

- `pnpm run test:provider-package-gate`：在仓库根目录运行 package
  typecheck、全量业务测试与 packed CJS/ESM
  smoke；CI 和本地 pre-commit 共用该入口；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk typecheck`：验证源码和公开声明类型；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk conformance:affected -- --package @ai-sdk/deepseek`：按上游 package 运行定向矩阵；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk conformance`：运行全部 Provider
  codec 矩阵，上游升级和 package 边界变化前必须执行；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk test`：运行纯函数、failure/stream 与全部 Provider 两轮 conformance；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk build`：生成 CJS、ESM、DTS；
- `pnpm --filter @linnlabs/linnkit-provider-ai-sdk pack-smoke`：打 tarball，并从实际打包内容分别加载 CJS/ESM 生产和 conformance 出口，完成 DeepSeek 两轮工具调用；
- 消费 Host 还必须验证 package 依赖边界、第三方 NOTICE、正式 backend
  bundle 和 packaged consumer，不能只验证 workspace alias。

测试以业务 round-trip 为中心。不要为 factory 数组顺序、目录结构、README、CSS 或完整大 snapshot 写测试；registry 只验证 capability 全覆盖、无重复、surface/auth
admission 和关键正式 package 身份。

## 安全与版本策略

Provider
body、SSE 和错误正文只允许存在于单次调用内存或离线 fixture。日志、canonical
event、audit 和 UI 只能看到稳定分类与安全聚合。SDK 默认错误打印必须被接管，package 不读取环境变量，也不持久化凭据或 Provider
session。

当前版本为 `0.1.x`，只作为宿主应用 monorepo 内部 workspace
package 维护，不发布 npmjs，也不把 package
name 可安装视为工程完成条件；manifest、构建和真实 tarball
smoke 用于守住独立边界。AI SDK 7 与当前正式 Provider
packages 的运行时下限是 Node.js 22，因此本 package 不伪装支持 Node
20；Linnkit 内核仍可维持自己的独立运行时范围。

当前只有宿主应用这个真实消费者。未来只有出现第二个真实 Host 和明确的外部安装需求，才重新评估独立公开与分发；不得仅为了删除示例代码中的少量重复实现而制造发布义务。生产链仍禁止保留旧 Host
language 实现、兼容 re-export、双 registry 或运行时动态 package 下载。
