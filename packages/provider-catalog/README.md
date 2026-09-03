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

来源和依赖只保留贡献者需要理解的稳定边界：目录数据来自 models.dev，语言推理 codec 由
`@linnlabs/linnkit-provider-ai-sdk` 统一接入 Vercel AI SDK Provider package。精确版本与许可证分别以 package
manifest 和根 `THIRD_PARTY_NOTICES.txt` 为准，不在本 README 复制依赖清单或调研过程。

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

## 上游与许可证

Provider Catalog 只直接复用一类外部数据：models.dev 的模型目录。同步器对其公开 API 做严格解析，再由 Linnya
自己的 admission policy 生成公开目录和 Host-only runtime binding；它不复制 models.dev 的实现源码，也不接受上游
`npm` 或 `api` 字段直接决定运行时 package。

语言推理不由本 package 实现。正式 Provider codec 统一由
[`@linnlabs/linnkit-provider-ai-sdk`](../linnkit-provider-ai-sdk/README.md)
通过 Vercel AI SDK Provider package 接入；该 package 的 manifest 是精确版本 owner，conformance 是行为 owner。
Catalog 只提供产品身份、准入政策和 runtime profile，两者由 Linnya Host 显式连接。

许可证与来源公告由根
[`THIRD_PARTY_NOTICES.txt`](../../THIRD_PARTY_NOTICES.txt)
及发布门禁统一维护。models.dev 的 MIT 声明、Vercel AI SDK 及各 runtime dependency 的许可证都随实际制品依赖闭包生成和校验。
README 不重复这些法律文本或逐项版本台账，避免文档与真实依赖漂移。

如果未来复制或修改第三方源码，应在实际源码附近保留必要来源说明，并同步更新 NOTICE；如果只是依赖 package、参考设计或比较候选方案，
则分别由 manifest、NOTICE、Git history 或 Pull Request 承担追溯，不把阶段调研长期保留在模块 README。
