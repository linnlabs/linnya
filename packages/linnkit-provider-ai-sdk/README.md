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
| 具体第三方 package factory                    | `src/providers/<provider>/`                         | 一个正式 Provider/capability 一个局部模块；只声明 factory、package identity 和必要 options |
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
`/contracts`。当前 peer 最低为 `0.32.2`，开发与 Host 装配使用同一精确版本，以消费已修复的正式声明产物。
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

Host 产品目录与 adapter 不能互相依赖。产品目录只描述 Host 允许什么 route；adapter 只描述某个技术 capability 如何通过第三方 package 执行；它们只能在 Host
composition seam 相遇。

Host 可以注入两类扩展，但不得借此污染通用 adapter：

- `provider_failure_classifier`：把 Host 管理服务的安全结构化错误映射到产品 failure
  code；
- `diagnostic_sink`：消费 adapter 已白名单化的 attempt 请求形状、负载规模（含图片所在消息角色）、流终态、阶段、shape、code 和 retryable 信息，并决定日志级别与文案。请求 fingerprint 只由安全的请求形状摘要计算，不包含 prompt、工具正文或图片字节。

扩展点不能读取或返回 prompt、response body、API key、headers、base
URL、路径、图片 bytes 或原始错误正文。

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
