# `@linnya/provider-catalog`

Linnya 产品专用的 Provider Catalog
package。它拥有经过审计的产品目录、模型准入、公开目录与 Host 私有 runtime
binding 的同代生成，以及 models.dev 上游同步和差异报告。

本 package 是 Provider Catalog 的唯一源码 owner。应用只通过 package
exports 消费目录；旧 `src/domains/provider-catalog`
和 Host 私有 manifest 入口不保留兼容转发层。

## Owner

- ProviderDefinition、ProviderConnectionDefinition、ProviderModelDefinition 与 Linnya
  stable/preview/hidden 产品政策；
- models.dev 输入严格解析、source digest、admission policy 与双投影生成；
- `@linnya/provider-catalog` 的公开只读查询；
- `@linnya/provider-catalog/runtime-bindings`
  的 Host-only 严格解析与只读 registry；
- package-local sync/check/diff 和生成资产一致性。

## 明确不拥有

- API Key、OAuth token、ProviderAccount、ConfiguredProvider 或 Workspace
  ModelConfig；
- AI SDK factory、请求体、SSE、usage、continuation 或错误分类；
- Agent loop、上下文、工具执行、retry/fallback；
- ChatGPT `/models`、Linnya Cloud 或 Ollama 的动态模型发现；
- Renderer 状态和设置交互。

## 上游事实复用原则

模型目录变化应尽量表现为上游数据变化，而不是 Linnya 代码变化。Provider、模型 ID、容量和能力资料优先来自 models.dev、厂商官方动态目录或其他经过审计的开源数据源；Linnya 只维护产品准入、发布状态和无法安全自动推导的少量政策，不在多个模块复制静态模型表。

上游新增模型且现有 connection/route/package 已覆盖其协议时，正常改动范围应限于同步、人工 diff、准入 policy 与业务 conformance，不得新增 Provider
factory、Host 分支或 Renderer 特例。只有上游资料缺失、错误或不满足产品安全要求时，才允许维护最小的本地补充事实，并记录来源、理由、复核时间和删除条件。

具体上游、许可证、复用方式、本地差异和升级退出条件统一记录在本文“来源与复用台账”。

具体 wire codec 继续遵循
[`@linnlabs/linnkit-provider-ai-sdk`](../linnkit-provider-ai-sdk/README.md)
的 package-first 规则：优先复用 Vercel AI SDK 或经过审核的开源 Provider
package，把高速变化的模型和协议维护交给其上游 owner；Catalog 不以生成资产为理由复制请求体、SSE、工具或 usage 实现。

## 依赖方向

本 package 只允许依赖
`@app/schemas/provider-catalog`、`@app/schemas/model-inference`、`zod`；sync 子入口可以依赖 Node 标准库。禁止依赖 Linnkit、AI
SDK、Electron、Renderer、Cloud、Model Catalog 和 Linnya Host 源码。

Renderer 只能通过 Linnya HTTP DTO 消费公开目录，禁止导入
`runtime-bindings`。Linnya Host 可以分别读取公开目录与 runtime
binding，但 Catalog package 不反向调用 Host。

## 修改地图

| 要改的内容                       | 唯一入口                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| Provider/模型公开合同            | `src/definitions/providerCatalog.ts`                                     |
| 跨端 HTTP wire schema            | `packages/schemas/src/provider-catalog/`                                 |
| models.dev 输入合同              | `src/features/catalog-admission/definitions/modelsDevSource.ts`          |
| 产品身份、模型准入与已验收 route | `src/features/catalog-admission/registry/providerAdmissionPolicies.ts`   |
| 外部事实到两个生成投影的规则     | `src/features/catalog-generation/generateProviderCatalog.ts`             |
| list/get/search                  | `src/features/catalog-query/`、`src/registry/providerCatalogRegistry.ts` |
| 同步、digest 和人工 diff         | `src/features/upstream-sync/`、`bin/provider-catalog-sync.ts`            |
| public catalog 资产              | `src/generated/provider-catalog.generated.json`                          |
| Host-only runtime binding 资产   | `src/generated/provider-runtime-bindings.generated.json`                 |
| 后端只读 API                     | `src/electron-main/routes/providerCatalogRouter.ts`                      |

## 六个不能混用的概念

- `ProviderDefinition`：OpenAI、Kimi（月之暗面）、智谱 AI 这样的供应商品牌；
- `ProviderConnectionDefinition`：品牌下具体的接入产品与 credential
  boundary，例如 OpenAI API、ChatGPT 订阅、Kimi Code 或 GLM Coding Plan；setup
  field、动态/静态模型来源和发布状态都属于 connection；
- `ProviderModelDefinition`：用于选型的模型资料，不是 Workspace 中已经配置的模型实例；
- `ModelConfig`：用户已经添加到当前 Workspace、可以被业务选择的模型；
- `InferenceEndpoint`：URL、凭据引用和严格 route 的运行连接，普通用户无需理解；
- `RuntimeAdapterProfile`：Host 内部把 canonical
  inference 交给哪个第三方 package codec。

“套餐”是产品计费方式，不是认证类型。订阅后仍发放普通 API
Key 的产品继续使用 ProviderDefinition、ConfiguredProvider 和 InferenceEndpoint；只有 OAuth、device
flow、短期令牌刷新或外部账号身份才需要 ProviderAccount。

“自定义 API”不是 ProviderDefinition。用户明确选择 OpenAI 兼容、OpenAI
Responses 或 Anthropic 兼容，再输入 URL、Key 和模型 ID；它不向持久化数据增加伪造的
`provider` 字段。

## 双投影边界

一次同步产生相同 generation ID/source digest 的两个投影：

1. public catalog：供应商品牌、有序 connection、setup
   field、帮助入口、模型容量和图片/tool/reasoning 能力，供后端只读 API 和 Renderer 使用；
2. runtime binding：按 connection ID 绑定官方 base URL、auth
   profile 和已通过 conformance 的 route profile，只供 Linnya Host 使用。

models.dev 的 `npm`、`api`
和其他目录 package 版本只是同步时的来源观察值，不能覆盖 Linnya runtime
policy。例如，正式 Provider 有专用 AI SDK package 时不得退回通用 compatible
codec；OpenCode
Go 可按模型混用 Chat、Responses 和 Anthropic，私有 binding 必须显式记录模型 route。ChatGPT 公开目录只声明产品身份与 OAuth
setup，授权后的模型来自当前账号的 Codex `/models`。

公开资产禁止出现 package、capability ID、API surface 和 auth
profile。Renderer 不能从模型名、URL 或上游 package 建议推断协议。

## Runtime binding 消费边界

- Provider onboarding 从 `@linnya/provider-catalog/runtime-bindings`
  投影默认 route，不再次解析 JSON；
- Linnya Host composition 用全部 binding 核对 adapter
  factory 的 surface/auth 完整性；
- BYOK
  live/readiness 从同一 registry 生成 target、URL 与环境变量约定，不维护第二张厂商表；
- runtime binding 不选择第三方 package。package factory 由 AI SDK
  adapter 的类型安全 registry 显式审核。

## 同步流程

显式执行 `pnpm run sync:provider-catalog`。同步器下载 models.dev
API 到内存、严格解析被消费字段、计算 SHA-256、按 admission
policy 生成两个资产，并输出模型新增、删除、容量变化及 runtime/source
observation 变化；原始 payload 不写入仓库。两个正式资产写入临时文件并通过单体 schema、generation/source
digest 和模型 route 跨投影校验后才替换，且不创建历史备份目录。source
digest 与 policy version 都未变化时不会重写资产。

同步器是仓库维护能力，只通过根命令或 package-local `sync` / `sync:check`
脚本运行，不声明安装期 CLI bin。Catalog 当前是 `private` workspace package，提前把尚未构建的
`dist/catalog-sync.js` 声明成 bin 会让 clean install 产生无效链接警告，也会制造一个没有独立发布合同的入口。

`pnpm --filter @linnya/provider-catalog sync:check`
执行相同获取、生成和校验，但永远不写文件；上游有待评审变化时输出 diff 并以失败状态退出。应用启动和 Provider 页面打开都不会隐式执行同步。

Provider 删除、API 地址、package 建议和容量变化都必须人工评审。一个上游 Provider 可能同时包含 chat、embedding、TTS 等模型；Agent 目录必须依靠明确能力 admission，不能按名称猜测或整组接纳。新增 policy 前还要证明对应 factory、许可/NOTICE、single-step/zero-retry、tool/图片/usage/Abort/error 和 durable
continuation conformance。

ChatGPT `/models`、Linnya Cloud
catalog 与 Ollama 本地发现是运行时动态来源，不进入 bundled
models，也不由同步器联网刷新。

Catalog 运行时只暴露非 `hidden`
connection；同一品牌全部 connection 都隐藏时，品牌也不会进入公开 API。`hidden`
仍保留在生成资产与 Host runtime
manifest 中，供 conformance 和准入审阅使用，不能由 locale、环境变量或错误回退绕过。当前 GLM
Coding Plan 因官方仅允许指定工具使用而保持 hidden；Kimi
Code 与中国站普通 API 独立于既有国际站 connection，不能共用 Key 或静默切换 endpoint。

## 构建门禁

Linnya Electron Backend 保留 package export 边界，在运行时从本 package 的 `dist` 加载公开
Catalog 与 Host-only runtime binding。根目录的 `build:backend`、`dev:backend` 和
`watch:backend` 会先执行 `prepare:backend-workspace-dependencies`，构建 schema 后再构建本
package；不得让 Backend 直接读取未验证的历史 `dist`，也不得在运行时回退到 `src`。

`pack-smoke` 不只检查 tarball 存在：它会解包制品，分别通过 Node ESM/CJS 导入两个公开入口，
验证 public catalog 与 runtime binding 属于同一 generation，并执行代表性的 connection/binding
查询。根 `test:provider-package-gate` 同时覆盖本 Catalog package 与 AI SDK adapter package。

- `pnpm --filter @linnya/provider-catalog typecheck`
- `pnpm --filter @linnya/provider-catalog build`
- `pnpm --filter @linnya/provider-catalog test`
- `pnpm --filter @linnya/provider-catalog sync:check`
- `pnpm --filter @linnya/provider-catalog pack-smoke`
- `pnpm run guard:provider-package-boundary`
- `pnpm run test:provider-catalog-package-gate`

业务测试覆盖 source
key/id、关键容量、模型能力 admission、deprecated/non-text-output 过滤、上下文/输入上限、动态目录、专用 route 不被上游 npm 建议覆盖、公开/私有投影隔离、generation/digest 一致、同步 no-op 不写盘、非法上游输入不产生半套资产、人工 diff 摘要以及 list/get/search。不要为字段顺序、README 文案或整个 JSON 快照写测试。

本 README 是 Catalog 所有权、双投影、同步事务和业务门禁的长期真源。AI SDK
factory 与 codec 的长期合同由 `packages/linnkit-provider-ai-sdk/README.md`
持有；Catalog 不反向依赖该 package，二者只由 Linnya Host composition 显式连接。

## 来源与复用台账

以下记录保存 Provider Catalog 及其正式推理 package 的上游、许可证、采用方式、本地差异和升级退出条件。它是当前依赖与来源决策的一部分，不是阶段施工日志；实现和版本事实仍以 package manifest、生成资产及 conformance 为准。

### models.dev

- 上游：`https://github.com/anomalyco/models.dev`，API：`https://models.dev/api.json`；
- 许可证：MIT，Copyright (c) 2025 models.dev；
- 本次使用：生成资产中的 Provider 模型 ID、展示名、容量、输入模态、tool/reasoning、family、release
  date；
- 当前生成 digest：以 `provider-catalog.generated.json` 的
  `generation.source_sha256` 为准；
- 本地 owner：`packages/provider-catalog`；public catalog 与 Host-only runtime
  binding 由同一 package 同代生成；
- 本地修改：没有复制上游实现源码；用 Linnya 自己的严格 source
  schema 和 admission policy 投影少量模型事实；
- 限制：上游 `npm`/`api` 只进入 Host 私有同步观察值，绝不直接选择 runtime
  package；
- 升级退出：models.dev 合同不可用时，可替换同步 source adapter，公开 Provider
  Catalog 和 Host binding 合同不变。

MIT 许可证要求保留版权与许可声明。根 `THIRD_PARTY_NOTICES.txt`
已登记 models.dev，并由现有发布 NOTICE 生成/校验门禁随安装包分发。

### Language Provider package 所有权

- 本地 owner：`packages/linnkit-provider-ai-sdk`；下文所有用于 language
  inference 的 `@ai-sdk/*` 与 OpenRouter 官方 package 均由该 package
  manifest 直接、精确持有，不再由根应用代持版本；
- 源码归属：每个正式 Provider/capability 只在
  `packages/linnkit-provider-ai-sdk/src/providers/<provider>/`
  声明 factory 与必要 options，body/SSE codec 继续由第三方 package 拥有；
- 验收归属：`packages/linnkit-provider-ai-sdk/conformance/providers/`
  保存真实 codec 的两轮工具、reasoning、usage 和 continuation 证据；Linnya
  Host 只保存 Catalog parity、route/credential 和产品策略测试；
- 许可证归属：发布 NOTICE 工具同时扫描根应用和 adapter package 的真实 runtime
  dependency closure；不因根 `package.json` 不再列出 concrete language
  Provider 而丢失公告；
- 升级边界：更新单个 Provider 时只修改 adapter
  package 的对应模块、精确依赖和定向 conformance，再运行全矩阵、packed
  CJS/ESM、NOTICE 与 Linnya 装配门禁。models.dev 同步不得修改 runtime factory。

首个真实升级演练选择
`@ai-sdk/deepseek 3.0.28 -> 3.0.29`。上游 patch 将缺失 tool-call
ID 的判断从仅处理 `null/undefined`
收紧为同时处理空字符串，并为其生成有效 ID；公开 API 和 Linnya canonical
contract 均未变化。本地没有复制或修改上游 codec，只更新 adapter
package 的精确依赖与 NOTICE。DeepSeek 定向 conformance、adapter 全矩阵、packed
CJS/ESM/DTS、Backend bundle 和 Electron packaged consumer 是本次升级的退出证据。

2026-08-27 全量刷新把 Core 固定到
`ai@7.0.83`、`@ai-sdk/provider@4.0.8`，并把各正式 Provider
package 更新到 adapter
manifest 中的精确版本；根应用仍直接拥有的图片、Embedding、Reranking 依赖同步对齐，避免同一制品存在冲突版本。AI
SDK 7.0.83 新增的 `StreamProviderError`
会包装流中上游故障，本地只消费其公开的 type/code/status/retryable 判别字段，绝不记录 message 或 data。品牌/connection 切片加入 Kimi
Code 与 GLM Coding Plan 专属 base
URL 后，完整矩阵为 120 项；类型检查、构建和 NOTICE 门禁是本轮静态退出证据，真实 BYOK/packaged 门禁仍按各 connection
release status 独立执行。

### Cline

- 本地上游：`<upstream-workspace>/cline`；
- commit：`8224ad1634c752fc02b0adc67eef7f5891a80ca9`；
- 许可证：Apache-2.0；
- 研究路径：`sdk/packages/llms/src/catalog/README.md`、`catalog/catalog-live.ts`、`providers/registry.ts`、`scripts/generate-models.ts`；
- 复用内容：generated
  catalog、构建期同步、容量字段语义和 registry/change-locality 的架构方法；
- 复制情况：设计复用，无逐字复制；
- 未采用：Cline 的运行时 live
  catalog。Linnya 桌面需要版本可复现和完全离线运行，因此网络只存在于显式开发同步命令。
- Phase
  4 追加研究：`sdk/packages/llms/src/providers/registry.ts`、`catalog/catalog-live.ts`、`scripts/generate-models.ts`、`src/tests/provider-vcr.test.ts`
  与 `src/tests/provider-vcr/README.md`；采用 manifest/factory 分层与 VCR
  record/playback 的组织原则。
- Phase 4 acquisition 决策：`reuse_internal`。Linnya 现有 AI SDK
  registry 已包含更窄的 canonical/surface/auth 合同，因此没有复制 Cline
  runtime；live target 改由 Linnya 的正式 runtime manifest 纯投影生成。
- OpenCode Go 追加研究：`providers.generated.ts` 把整个产品固定为
  `family: openai-compatible`。官方模型表实际按模型混用 Chat、Responses 和 Anthropic，这种 Provider 级扁平化会把部分模型送入错误 codec，因此本次只复用 Cline 的目录/UX 组织，不复制该 transport 结论。

### OpenCode

- 本地上游：`<upstream-workspace>/opencode`；
- commit：`172d08cb981248023c82f5b9d138763b27d69783`；
- 许可证：MIT；
- 研究路径：`packages/core/src/models-dev.ts`、`packages/opencode/src/provider/provider.ts`；
- 复用内容：models.dev 作为模型事实源、Provider package
  inventory 与业务目录分离的思路；
- 复制情况：设计复用，无逐字复制；
- 未采用：启动期 cache/refresh。它会让同一 Linnya 版本在不同日期拥有不同模型与能力，不符合 conformance 和离线要求。
- Phase 4 追加研究：当前 sparse checkout 通过 `git show` 审阅
  `packages/opencode/src/provider/provider.ts` 的 `BUNDLED_PROVIDERS` 与
  `packages/core/src/models-dev.ts`；将其 package inventory 用作 Cohort
  B 候选来源，不复制其中的 `any` factory、厂商特判、在线刷新或 message
  transform。
- Phase 4 acquisition 决策：`reuse_internal`。先让现有类型安全 factory
  registry 与生成 manifest 建立强制 parity，再逐 package 准入；没有逐字复制源码。
- OpenCode Go 追加采用：`provider.ts#fromModelsDevModel` 先读
  `model.provider.npm/api`，再回退 Provider 默认值，证明 Provider 身份、凭据与模型 wire
  route 应分层。Linnya 复用该数据模型，把模型级覆盖放入 Host 私有 runtime
  binding；没有复制 OpenCode 的动态 package loader、`any`
  factory、在线目录或厂商 transform。

### Hermes Agent

- 本地上游：`<upstream-workspace>/hermes-agent`；
- commit：`4cee9aab6174d857352616263a358bae61c43bbb`；
- 许可证：MIT；
- 研究路径：`hermes_cli/provider_catalog.py`；
- 复用内容：CLI/GUI 共用 Provider membership 的合同参考；
- 复制情况：设计复用，无逐字复制；
- 本地差异：Linnya 用后端只读目录作为所有 UI 的单一来源，不维护 Python/Renderer 两份集合。
- Phase 4 追加采用：把“一个 canonical
  universe，其他入口只做投影”的 parity 思路扩展到 onboarding、AI SDK factory
  admission 与 BYOK
  live/readiness；实现仍为 Linnya 自有 TypeScript，没有复制 Python 源码。

### Craft Agents OSS

- 本地上游：`<upstream-workspace>/craft-agents-oss`；
- commit：`50ffa143ab76e44c0e96ea785d03aa67cf942c50`；
- 许可证：Apache-2.0；
- 研究路径：`packages/shared/src/config/provider-metadata.ts`；
- 本次使用：只用于确认 Provider 展示元数据和 runtime config 应分离；
- 复制情况：设计复用，无逐字复制；
- Phase
  2 追加研究：`apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx`
  与 `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx`；
- 采用：Provider 选择与凭据表单分层、普通 Provider 不展示协议/容量输入的产品结构；
- 未整体复制：`ApiKeyInput.tsx`
  含大量厂商分支和产品状态，不符合 Linnya 目录驱动与 change-locality 目标；
- 复制情况：设计复用，无逐字复制。Linnya 使用现有 Settings
  Kit/CustomSelect 和共享 Provider DTO 实现。

#### OpenCode Go API-Key plan

- capability：同一个 OpenCode Go 产品、一个 API
  Key、按模型选择 OpenAI-compatible Chat、OpenAI Responses 或 Anthropic
  Messages；
- candidates：OpenCode `provider.ts#fromModelsDevModel` 的模型级
  `npm/api`；Cline `providers.generated.ts` 的单 compatible route；Craft 固定的
  `@earendil-works/pi-ai@0.80.6` `opencodeGoProvider()`；OpenCode
  Go 官方模型表；Linnya 现有三个 Vercel AI SDK factory；
- decision：`reuse_internal`。复用 OpenCode 的模型级 route 数据模型和 Linnya 已 pin 的
  `@ai-sdk/openai-compatible`、`@ai-sdk/openai`、`@ai-sdk/anthropic`，不新增 package，也不复制 Provider
  wire codec；
- reason：Cline 的 Provider 级 compatible
  route 与官方模型表冲突；Pi 虽提供单入口，但它是另一套完整推理 runtime，审阅版本只有 13 个 Go 模型且缺少 Responses 路由，接入会制造第二套 body/SSE/usage/重试 owner；
- facts source：模型 ID、容量与能力仍由 models.dev 进入离线生成器；模型 route 以
  [OpenCode Go 官方文档](https://dev.opencode.ai/docs/go/)
  为准。当前 models.dev 顶层 package 观察值和部分模型覆盖不完整，不能自动覆盖 Linnya
  runtime policy；
- local
  changes：Host 私有 manifest 新增显式模型 route 覆盖；ConfiguredProvider 只拥有 Provider/ModelConfig 归属；同一 Provider 的多个 InferenceEndpoint 共用一份 stored-secret
  credential；Renderer 仍只展示一次 Key 输入和模型列表；
- conformance：目录生成器校验覆盖模型与已准入 profile；onboarding 业务测试证明三条 route 共享凭据；AI
  SDK 集成测试证明 `/chat/completions`、`/responses`、`/messages`
  都使用同一 Bearer Key；
- release：20 个当前工具型模型以 `preview` 进入目录。真实 OpenCode Go
  Key 的两轮 Agent 与 packaged smoke 完成前不升 `stable`；
- upgrade exit：升级 models.dev 或官方模型表时审阅模型新增/删除和 route
  diff，再统一跑生成、三 codec、onboarding、真实 Key 与 packaged
  conformance；不维护厂商 body/SSE fork。

#### ChatGPT subscription OAuth

- capability：浏览器跳转、固定本地 callback、PKCE、state/flow ownership、token
  exchange/refresh 与安全凭据持久化；
- candidates：Craft
  `packages/shared/src/auth/chatgpt-oauth-config.ts`、`chatgpt-oauth.ts`、`apps/electron/src/preload/bootstrap.ts`、`packages/server-core/src/handlers/rpc/llm-connections.ts`；Cline
  `apps/vscode/src/integrations/openai-codex/oauth.ts`；Pi
  `dist/utils/oauth/openai-codex.js`；
- decision：`copied_source`，Craft 是唯一源码 owner，Cline/Pi 只作协议交叉验证；
- reason：用户已在 Craft `50ffa143`
  实测“浏览器登录 → 自动回调 → 直接可用”；Craft 的 client/server flow
  ownership 与 Linnya Electron + Host 边界相近，复制窄切片比引入整套 Pi
  runtime 或重新手写 OAuth 更易审计；
- upstream：Craft Agents OSS
  `50ffa143ab76e44c0e96ea785d03aa67cf942c50`，上述四条路径，Apache-2.0；
- local changes：随机 state/PKCE、固定 callback、token exchange/refresh 和 flow
  TTL 语义保持一致；按 Linnya `provider-account`
  domain 拆分 definitions/functions/orchestration/secret
  store，错误对外只暴露稳定 code，不复制 Craft connection
  slug、RPC 框架、日志正文和 Pi
  Agent 状态；回调页固定使用一次性 HTTP 连接，Host 收尾主动终止浏览器遗留 keep-alive
  socket，避免凭据已落盘后授权响应仍被 `server.close()` 阻塞；
- upgrade
  exit：升级 Craft 时只对比这四条来源和 Cline/Pi 合同；若 OpenAI 发布稳定、可嵌入且不拥有 Agent
  loop 的授权 package，则通过相同 OAuth/refresh/packaged
  conformance 后删除本地 copied source。

#### ChatGPT Codex Responses transport

- capability：授权后的 ChatGPT subscription 单步 Responses 请求；
- candidates：Linnya 既有 `@ai-sdk/openai` Responses factory；Craft 使用的
  `@earendil-works/pi-ai@0.80.6` `openai-codex-responses`；Cline 的 OpenAI
  Responses vendor adapter；
- decision：`reuse_internal`，优先复用 `@ai-sdk/openai`，建立独立
  `chatgpt_codex_responses` route profile；不引入 Pi runtime，不复制它约 50
  KB 的 request/SSE/WebSocket/retry 实现；
- reason：Pi 的实现确认 Codex backend 使用
  `https://chatgpt.com/backend-api/codex/responses`、OAuth bearer、JWT account
  claim、`originator`、顶层 `instructions`、非 strict
  tools、`reasoning.summary=auto`、`store=false` 和 encrypted
  reasoning 回放，并省略 `max_output_tokens`。OpenCode 对 Codex 同样显式清除
  `maxOutputTokens`；Cline 当前采用
  `ai-sdk-provider-codex-cli`，其旧请求样本也不发送该字段。普通 OpenAI
  Responses 的默认投影不能直接等同于 ChatGPT 订阅产品。Pi 内置 retry、WebSocket
  session cache、错误解析和完整 codec 会与 Linnkit/AI
  SDK 形成第二套 owner，因此仍复用现有 AI SDK factory，只维护窄的 profile
  request projection；
- account model catalog：不再复制 Pi 的静态 ChatGPT 模型表。授权后按 OpenAI
  Codex `2494d939cfb33f95cbce61ac7283193861960577` 的
  `codex-rs/codex-api/src/endpoint/models.rs`、`protocol/src/openai_models.rs`
  和 `models-manager/src/manager.rs` 合同请求
  `GET /backend-api/codex/models?client_version=...`；只接纳 `visibility=list`
  模型，使用 `context_window`、`effective_context_window_percent` 与
  `input_modalities`
  投影容量和视觉能力。Codex 是 Apache-2.0；本地只复用公开 wire/过滤语义，没有复制 Rust 实现、缓存、fallback
  catalog 或 Agent runtime；
- local changes：attempt route 保留 `chatgpt_codex_responses`
  identity；该 profile 在共享 AI SDK
  projector 内投影 Codex 的 instructions/tool/reasoning/output-limit 选项，OAuth
  URL 与请求 header 共用 `originator=linnya`。不新增 body builder、SSE
  parser、Provider Agent loop、服务端 conversation 或 package retry；
- upgrade exit：AI
  SDK/Craft/Pi 任一升级后重跑固定 body/event/tool/image/usage/Abort/zero-retry/durable
  round-trip 与真实 packaged smoke；Codex 升级时单独对比 ModelsClient
  URL/header、ModelInfo 被消费字段和 picker 可见性规则。若正式 package 出现则按同一门禁替换 factory，并删除专用 header 投影。

#### ChatGPT subscription image generation

- capability：复用已授权 ChatGPT subscription 生成图片；
- candidates：OpenAI Codex
  `codex-rs/codex-api/src/endpoint/images.rs`、`ext/image-generation/src/backend.rs`
  与 `ext/image-generation/src/tool.rs`；OpenAI 官方 GPT Image 2 模型和 Image
  API 文档；
- decision：`reuse_internal`。复用 Linnya 现有 Image Generation domain、AI SDK
  OpenAI-compatible capability 与 Provider account credential
  resolver，只新增账号能力到 Model Catalog 的窄进程内投影；
- reason：Codex `2494d939cfb33f95cbce61ac7283193861960577`
  明确使用当前 provider/auth 请求相对路径
  `images/generations`，独立工具模型固定为 `gpt-image-2`，响应为
  `data[].b64_json`，并附加
  `originator`。它不是 Responses 消息调用，因此不应继承
  `OpenAI-Beta`；官方文档也把 GPT Image 2 列为独立的 Image generation
  endpoint 模型；
- local changes：账号投影不持久化、不混入 `/models`
  发现结果；登录和启动恢复时加入 `catalog_source: account`
  图片模型，退出登录时移除。OAuth bearer、account
  ID 与 originator 由统一 model-request-auth 按请求解析，图片 adapter 不读取账号存储；
- upgrade
  exit：Codex 图片 endpoint、模型 ID 或响应合同变化时，重跑账号生命周期、credential/header、受控 HTTP
  body/bytes 和真实订阅 smoke。若出现正式 AI SDK Codex Images
  provider，则在相同 conformance 下替换 compatible capability，不保留双实现。

### Cline Renderer

- 同一上游/commit/许可证见上文 Cline；
- Phase
  2 研究路径：`apps/vscode/webview-ui/src/components/settings/ApiOptions.tsx`、`apps/vscode/webview-ui/src/components/settings/providers/GenericProviderSettings.tsx`；
- 采用：目录驱动 Provider/模型选择与通用 Key 表单的交互分层；
- 未整体复制：`ApiOptions.tsx`
  已形成大型 Provider 条件分支，直接复制会把厂商耦合带入 Linnya Renderer；
- 复制情况：设计复用，无逐字复制。Provider membership 由 Linnya 后端 public
  catalog 单向提供，Renderer 不维护同类条件树。

### NewMax

本地样本为专有/混淆构建，只作行为观察，不复制源码、常量、资源或结构。其 UI 行为不能作为许可证兼容的 acquisition
source。

### Mistral Cohort B package

- capability：首个 Cohort B 正式 package、目录准入与两轮工具回放；
- candidates：现有通用 compatible factory、OpenCode bundled inventory、Cline
  models.dev family、Vercel 官方 `@ai-sdk/mistral`；
- decision：`dependency`，精确固定 `@ai-sdk/mistral@4.0.30`；
- reason：官方 package 已拥有 Mistral chat
  body/SSE、reasoning、tool、usage 和图片 codec，继续借用通用 compatible 或手写 wire 都会扩大维护面；
- upstream：Vercel AI `@ai-sdk/mistral`，Apache-2.0；版本和许可证已进入根
  `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route
  profile、类型安全 factory、受控两轮 conformance 与 models.dev
  admission；没有复制 Provider codec；
- model admission：Mistral 上游分组还含 embedding/TTS，首批 Agent 目录要求
  `tool_call=true`，避免把 `mistral-embed` 当 chat；不按模型名过滤；
- release：当前为 `preview`。package
  codec、离线两轮工具/usage/reasoning、目录/onboarding/readiness 已通过；真实 Mistral
  BYOK 与 packaged Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、dedicated codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### xAI Cohort B package

- capability：第二个 Cohort B 正式 package、原生 Responses
  route、视觉工具结果与无状态 continuation 回放；
- candidates：现有通用 OpenAI-compatible/Responses factory、OpenCode 的
  `@ai-sdk/xai` bundled inventory、Craft 的 xAI 固定 URL/API
  Key 产品配置、Cline 原生 Provider、Vercel 官方 `@ai-sdk/xai`；
- decision：`dependency`，精确固定 `@ai-sdk/xai@4.0.41`；
- reason：官方 package 同时拥有 xAI Responses body/SSE、reasoning
  identity、tool、usage、用户图片与 `function_call_output`
  图片 codec；复制 Cline 原生 wire 或把 xAI 挂到通用 compatible 都会扩大协议维护面；
- upstream：Vercel AI `@ai-sdk/xai`，Apache-2.0；版本和许可证已进入根
  `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route profile、类型安全 factory、xAI
  package 自己的 provider metadata allowlist、受控两轮 conformance 与 models.dev
  admission；没有复制 xAI request body 或 SSE parser；
- model admission：models.dev 的 xAI 分组同时包含非 Agent 模型，首批目录要求
  `tool_call=true`，本代生成 6 个 Grok language model；不按模型名过滤；
- release：当前为 `preview`。package
  codec、reasoning/tool/usage、工具结果图片、目录/onboarding/readiness 已通过；真实 xAI
  BYOK 与 packaged Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、xAI 两轮 codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### Groq Cohort B package

- capability：Groq 正式 package、目录准入与两轮工具回放；
- candidates：OpenCode `BUNDLED_PROVIDERS` 的 `createGroq`、Cline 固定 Groq
  URL/Key、Craft key-only Provider 表单、Hermes 的 Groq
  endpoint 使用，以及 Vercel 官方 `@ai-sdk/groq`；
- decision：`dependency`，精确固定 `@ai-sdk/groq@4.0.29`；
- reason：官方 package 已拥有 Groq chat body/SSE、reasoning、tool、`x_groq`
  usage 和多轮 reasoning 回放；Linnya 无需把 Groq 当通用 OpenAI-compatible，也无需复制 wire
  codec；
- upstream：Vercel AI `@ai-sdk/groq`，Apache-2.0；版本和许可证已进入根
  `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route
  profile、类型安全 factory、独立两轮 conformance 与 models.dev
  admission；没有复制 Provider body/SSE 实现；
- model admission：首批 Agent 目录要求
  `tool_call=true`，排除 Whisper、TTS、Compound 和 Guard 等上游未声明工具调用的模型；本代生成 6 个 Groq 模型，不按模型名维护 allowlist；
- release：当前为 `preview`。真实 Groq BYOK 与 packaged Agent 记录完成后才能升
  `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、Groq 两轮 codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### Cerebras Cohort B package

- capability：Cerebras 正式 package、目录准入与两轮工具回放；
- candidates：OpenCode `BUNDLED_PROVIDERS` 的 `createCerebras` 与 integration
  header、Cline 固定 Cerebras URL/Key 及其旧 runtime reasoning 清理、Craft
  key-only Provider 表单，以及 Vercel 官方 `@ai-sdk/cerebras`；
- decision：`dependency`，精确固定 `@ai-sdk/cerebras@3.0.32`；
- reason：当前官方 package 已在 OpenAI-compatible
  codec 之上实现 Cerebras 的 structured-output 终态处理，并把出站 assistant
  `reasoning_content` 转为 Cerebras 要求的
  `reasoning`；因此不复制 Cline 不同 runtime/版本中的历史清理补丁；
- upstream：Vercel AI `@ai-sdk/cerebras`，Apache-2.0；版本和许可证已进入根
  `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route
  profile、类型安全 factory、独立两轮 conformance 与 models.dev
  admission；没有复制 Provider body/SSE 实现，也没有增加厂商消息重写；
- model admission：首批 Agent 目录要求
  `tool_call=true`，本代生成 2 个 Cerebras 模型；不按模型名过滤；
- release：当前为 `preview`。真实 Cerebras BYOK 与 packaged
  Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、Cerebras 两轮 codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### OpenRouter Cohort B package

- capability：OpenRouter 正式 package、目录准入与两轮工具回放；
- candidates：通用 OpenAI-compatible factory、OpenCode bundled
  `@openrouter/ai-sdk-provider`、Cline/OpenRouter 固定 URL +
  Key、Craft 与 Hermes 的 OpenRouter 产品入口，以及 OpenRouter 官方 AI SDK
  package；
- decision：`dependency`，精确固定 `@openrouter/ai-sdk-provider@3.0.0`；
- reason：官方 package 已拥有 OpenRouter chat body/SSE、tool、usage 与 signed
  `reasoning_details`
  codec；挂到通用 compatible 会丢失其可验证 continuation，并把 OpenRouter 私有协议维护重新推给 Linnya；
- upstream：OpenRouter
  `@openrouter/ai-sdk-provider`，Apache-2.0；虽然 package 不属于 `@ai-sdk/*`
  scope，完整许可证、版本和归属仍已进入根 `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route
  profile、类型安全 factory、官方 reasoning metadata
  allowlist、独立两轮 conformance 与 models.dev
  admission；不解析 body/SSE，不复制 package codec；
- model admission：首批 Agent 目录要求
  `tool_call=true`，本代生成 287 个 OpenRouter 模型；不维护按模型名的 allowlist；
- release：当前为 `preview`。真实 OpenRouter BYOK 与 packaged
  Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、OpenRouter 两轮 codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### Fireworks Cohort B package

- capability：Fireworks AI 正式 package、目录准入与两轮工具回放；
- candidates：通用 OpenAI-compatible factory、Cline 的固定 Fireworks URL +
  Key、Hermes 的 Fireworks endpoint，以及 Vercel 官方 `@ai-sdk/fireworks`；
- decision：`dependency`，精确固定 `@ai-sdk/fireworks@3.0.35`；
- reason：官方 package 已拥有 Fireworks chat body/SSE、reasoning、tool 和 usage
  codec；Linnya 不再把厂商当作通用 compatible，也不维护 wire 差异；
- upstream：Vercel AI `@ai-sdk/fireworks`，Apache-2.0；版本和许可证已进入根
  `THIRD_PARTY_NOTICES.txt` 自动门禁；
- local changes：只增加 canonical route
  profile、类型安全 factory、独立两轮 conformance 与 models.dev
  admission；没有复制 Provider body/SSE 实现；
- model admission：models.dev source ID 为 `fireworks-ai`，Linnya 产品 ID 固定为
  `fireworks`；首批 Agent 目录要求
  `tool_call=true`，本代生成 23 个 Fireworks 模型；
- release：当前为 `preview`。真实 Fireworks BYOK 与 packaged
  Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 后统一跑 factory parity、Fireworks 两轮 codec
  fixture、BYOK live 与 NOTICE 门禁，不维护本地 fork。

### Cohort C OpenAI-compatible Provider batch

- capability：SiliconFlow 国际站/中国站、NVIDIA
  NIM、ModelScope 的产品目录、固定 route 与两轮 Agent 回放；
- candidates：现有
  `@ai-sdk/openai-compatible`、npm 上的非官方单厂商 package、Cline generated
  Provider specs、OpenCode models.dev runtime 与 Hermes transport overlay；
- decision：`reuse_internal`，四个产品入口共享已精确固定的
  `@ai-sdk/openai-compatible@3.0.39` factory，不增加厂商 capability；
- reason：当前 `@ai-sdk/*`
  scope 没有这四个入口对应的正式 package；Cline、OpenCode、Hermes 与 models.dev 均把它们建模为 OpenAI-compatible
  transport，复制或引入低信任度 codec 只会扩大维护面。Z.AI 已因官方 package 发布从本批移出；
- upstream references：Cline `sdk/packages/llms/src/providers/builtins.ts` 与
  `providers.generated.ts`；OpenCode
  `packages/opencode/src/provider/provider.ts`；Hermes
  `hermes_cli/providers.py`；Craft
  `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx`；均只复用 Provider
  identity、默认 URL 和 transport 决策，没有复制源码；
- local changes：只增加 admission
  policy、models.dev 生成投影和共享两轮 conformance
  case；没有新增 factory、capability ID、route profile、message
  projector 或厂商 body/SSE 分支；
- endpoint
  decision：SiliconFlow 国际站与中国站由 models.dev/Cline 作为不同服务入口维护，默认地址分别为
  `api.siliconflow.com` 与
  `api.siliconflow.cn`，因此保留两个 ProviderDefinition，避免运行时按地区猜 URL；
- model admission：统一要求
  `tool_call=true`，再由现有生成器排除 deprecated、非文本输出和无有效容量模型；当前代生成 SiliconFlow
  49 + 45、NVIDIA NIM 61、ModelScope
  7，共 162 个模型；不按模型名维护 allowlist；
- release：四个入口当前均为 `preview`。共享 codec
  conformance 只证明协议能力，不代表每个模型都已真实执行；逐 Provider
  BYOK 与 packaged Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 `@ai-sdk/openai-compatible`
  或 models.dev 后统一跑共享 codec fixture、manifest parity、BYOK
  live 与目录 diff；若未来出现可信正式 package，按 Cohort
  B 门禁迁移并删除对应 compatible binding，不保留双路由。

### Z.AI official Provider package

- capability：Z.AI 国际站普通 API 的 GLM
  chat、reasoning、tool、usage 与 continuation；
- candidates：既有 compatible route、Vercel AI 新发布的官方
  `@ai-sdk/zai`、models.dev 与智谱官方 V4 API 文档；
- decision：`dependency`，精确固定 `@ai-sdk/zai@3.0.1`，新增独立 `zai_chat`
  capability，删除 Z.AI 对 `openai_compatible_chat` 的 runtime binding；
- reason：官方 package 已拥有 Z.AI V4 body/SSE、reasoning、tool 与 usage
  codec，继续借用 compatible 会忽略新的明确 owner，并让未来差异落入共享路径；
- local changes：只增加 route
  profile、类型安全 factory、上下文压缩规则与独立两轮 conformance，没有复制 Provider
  codec。官方 package 只支持 `toolChoice=auto`，canonical `none`
  会省略 tools 与 tool_choice，此差异已由 conformance 固定；
- model
  admission：仍由 Z.AI 普通 API 的 models.dev 分组生成，当前代 16 个模型；GLM
  Coding Plan 使用另一 connection 与独立目录，不复用本目录；
- release：保持 `preview`，官方 package conformance 不替代真实 Z.AI
  Key 和 packaged Agent；
- upgrade exit：升级 `@ai-sdk/zai`
  后运行独立 codec、全矩阵、NOTICE、真实 BYOK 与 packaged 门禁，不保留 compatible
  fallback。

### Kimi Code 与 GLM Coding Plan connection

- capability：同一供应商品牌下普通 API 与订阅/Coding
  Plan 的独立 endpoint、Key、模型目录和 runtime binding；不引入第二套 Agent
  loop；
- primary sources：Kimi
  Code 官方[概览](https://www.kimi.com/code/docs/)、[模型配置](https://www.kimi.com/code/docs/kimi-code/models.html)；智谱官方[快速开始](https://docs.bigmodel.cn/cn/coding-plan/quick-start)、[如何切换模型](https://docs.bigmodel.cn/cn/coding-plan/latest-model)、[使用须知](https://docs.bigmodel.cn/cn/coding-plan/usage-notes)与[指定工具](https://docs.bigmodel.cn/cn/coding-plan/tool/others)；
- observed facts：Kimi Code OpenAI-compatible base URL 为
  `https://api.kimi.com/coding/v1`，当前四个 Model ID 为
  `k3`、`k3-256k`、`kimi-for-coding`、`kimi-for-coding-highspeed`；GLM Coding
  Plan OpenAI Chat base URL 为
  `https://open.bigmodel.cn/api/coding/paas/v4`，当前全量套餐模型为 `glm-5.3` 与
  `glm-5.3-flash`，上下文 1M、最大输出 128K；
- decision：Kimi Code 复用 `@ai-sdk/moonshotai@3.0.41` 的 `moonshot_chat`
  capability；智谱中国站普通 API 与 GLM Coding Plan 复用官方 `@ai-sdk/zai@3.0.1`
  的 `zai_chat` capability。每条 connection 有独立 runtime
  binding，不做失败后协议 fallback；
- local changes：Provider Catalog v2/policy 14 新增 connection
  description、badge、官方 setup 帮助入口与 bundled
  models；只扩展生成政策和现有 package 的专属 base URL
  conformance，没有复制厂商 body/SSE codec；
- release：Kimi Code 为
  `preview`，等待真实会员 Key、客户端真实身份审计与 packaged Agent；GLM Coding
  Plan 因官方明确限制指定工具使用而为
  `hidden`，在 Linnya 被官方列入支持清单或取得书面许可前不得通过 locale、环境变量或错误路径公开；
- migration：旧 `moonshot` 与 `zai` 只迁移到国际站
  `moonshot-api-global`、`zai-api-global`，不改 ModelConfig
  route、InferenceEndpoint 或密文；中国站普通 API、Kimi Code、GLM Coding
  Plan 使用新 connection ID 和新 credential boundary；
- upgrade exit：每次模型或 endpoint 更新都重新核对上述官方页面，运行 Catalog
  diff/parity、package 双轮 durable conformance、真实 Key 与 packaged
  Agent；官方使用范围收紧时立即隐藏 connection，不以其他工具 User-Agent 冒充支持。

### Together AI、DeepInfra 与 Cohere Cohort B package

- capability：三条 simple direct Provider route、模型目录、Key-only
  onboarding 与两轮 Agent 回放；
- candidates：Vercel 官方
  `@ai-sdk/togetherai`、`@ai-sdk/deepinfra`、`@ai-sdk/cohere`，以及 models.dev、Cline、OpenCode、Hermes、Craft 的产品身份和默认 endpoint；
- decision：`dependency`，精确固定
  `@ai-sdk/togetherai@3.0.33`、`@ai-sdk/deepinfra@3.0.32`，并把既有
  `@ai-sdk/cohere` 升级到 `4.0.28`；
- reason：Together
  AI 与 DeepInfra 的正式 package 在 openai-compatible 基础上拥有各自 URL、认证和 usage 行为；Cohere
  package 同时提供原生 V2 language、embedding、reranking
  codec。Linnya 只注册严格 factory，不复制 body/SSE 或把 Cohere
  language 错挂到 reranking capability；
- upstream references：Cline
  `sdk/packages/llms/src/providers/builtins.ts`、`providers.generated.ts`
  与 routing rules；OpenCode models.dev Provider runtime；Hermes
  `hermes_cli/models.py` 的 DeepInfra endpoint/catalog；Vercel AI
  package 类型和实现；没有复制源码；
- local changes：新增三条 route profile/factory、各自独立的两轮 codec
  fixture、admission policy 与生成目录；Renderer、Linnkit、canonical message
  projector 均无 Provider 分支；
- protocol notes：Together AI 直接请求 `/v1/chat/completions`；DeepInfra
  factory 从 `https://api.deepinfra.com/v1` 追加
  `/openai/chat/completions`，且官方 package 修正部分 Gemini/Gemma reasoning
  usage；Cohere 使用
  `https://api.cohere.com/v2/chat`，thinking 没有跨轮签名，只回放 canonical
  ordered history；
- model admission：统一要求
  `tool_call=true`，再排除 deprecated、非文本输出和无有效容量模型；generation
  `models-dev-2026-08-20-3e94f7ad558a-p8` 生成 Together AI 19 + DeepInfra 56 +
  Cohere 9，共 84 个模型，不维护模型名 allowlist；
- Perplexity decision：`defer`。`@ai-sdk/perplexity`
  package 可用，但当前 models.dev 四个模型均未声明工具调用，不满足 Linnya 通用 Agent 工具循环；只有上游明确提供工具模型，或产品建立独立非工具搜索模型路由后重新评估；
- release：三个 Provider 均为 `preview`，真实 BYOK 与 packaged
  Agent 记录完成后才能升 `stable`；
- upgrade exit：升级 package 或 models.dev 后统一跑 factory
  parity、三条两轮 fixture、BYOK live、NOTICE 与目录 diff，不维护本地 fork。
