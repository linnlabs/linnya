# Model Catalog Domain

`model-catalog`
是桌面后端产品模型目录和用户 InferenceEndpoint 的唯一 owner。它合并内置默认目录、Linnya
Cloud 目录、账号能力投影和用户自定义目录，完成严格准入、凭据引用解析、用户模型与端点元数据持久化、进程内查询及 Cloud 刷新事件。正式 Provider 的本地配置身份与模型归属由
[`provider-configuration`](../provider-configuration/README.md)
独立拥有，不能塞回通用 `ModelConfig`。

它不执行模型请求。Vercel AI SDK、Provider
codec、usage/continuation 投影和单次请求编排位于
[`app-hosts/linnya/adapters/inference`](../../app-hosts/linnya/adapters/inference/README.md)；非 Agent 推理合同位于
[`domains/model-inference`](../model-inference/README.md)；Renderer 配置状态位于
[`apps/renderer/domains/model-configuration`](../../../apps/renderer/domains/model-configuration/README.md)。

---

## 修改前先看哪里

| 要改的内容                                        | 先看                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ModelConfig`、目录 diff、公开 port               | `definitions/modelCatalog.ts`                                                                                          |
| route、identity、capability、API base 准入        | `features/catalog-admission/`                                                                                          |
| Linnya Cloud 模型拉取、ID、设备身份               | `features/cloud-catalog/`                                                                                              |
| 内置默认模型与启动路径                            | `features/default-catalog/`                                                                                            |
| InferenceEndpoint、CredentialReference 与安全密文 | `features/inference-endpoints/`                                                                                        |
| `user_models.json` 格式与原子写入                 | `features/user-model-persistence/`                                                                                     |
| 四个来源如何合并、CRUD、Cloud retry/event         | `registry/modelCatalogRegistry.ts`                                                                                     |
| Electron 启动如何冻结默认目录路径                 | `electron-main/app-lifecycle/functions/resolveAppDefaultModelsPath.ts`                                                 |
| HTTP 模型查询/编辑/删除入口                       | `electron-main/routes/modelRouter.ts`                                                                                  |
| 模型注册入口                                      | `app-hosts/linnya/application/provider-onboarding/`、`custom-api-onboarding/` 与 `ollama-onboarding/`                  |
| 推理 route 跨端 schema                            | `packages/schemas/src/model-inference/`、`packages/schemas/src/document-ocr/` 与 `packages/schemas/src/transcription/` |

---

## 负责与不负责

### 负责

- 持有桌面后端 `ModelConfig` 和目录 CRUD 公共合同；
- 从 default、Cloud、account、user 四个来源形成当前进程目录；
- 对 route schema、endpoint model/base identity、capability、reasoning 和 API
  base 做统一准入；
- 解析显式
  `CredentialReference`，并通过 InferenceEndpoint 复用 endpoint、认证 profile 和凭据；
- 把用户密钥经 Desktop Host credential protection
  capability 加密后保存到 AppData，目录 DTO、Workspace、日志和 Pinia 不出现明文；
- 在同一个正式 Provider connection 的 endpoint 上添加模型时复用 credential
  boundary；同品牌另一 connection 必须使用独立 endpoint/credential，用户再次提交 Key 只替换当前 boundary 的 secret，目录写盘失败时恢复旧 secret；
- 原子持久化用户模型和 InferenceEndpoint 元数据，写盘成功后才提交内存状态；
- 提供 capability、UI visibility、tag、purpose default 等目录查询；
- 在 Cloud 目录成功刷新后发布窄事件，由 Desktop Host
  capability 桥接为 Renderer 重新拉取信号。

### 不负责

- 创建 Vercel AI SDK Provider、发起模型请求或解析 Provider 响应；
- 决定 Agent retry/fallback、业务用途选择或 Knowledge Base 降级；
- 持有 Renderer Pinia/localStorage 状态、表单或 UI；
- 实现 Cloud KV/Admin、配额、代理或未来 FastAPI/API 网关；
- 把 endpoint、model name 或 provider 字符串猜成推理协议；
- 保存 OpenRouter routing/header 或 Claude SDK
  auth/timeout 这类厂商 codec 配置；正式 package option 只能由 Host runtime
  profile 拥有；
- 保存正式 Provider 产品身份、ProviderDefinition 关联或模型来源分组；
- 修复、双读或静默接受缺少 typed route 的旧用户配置。

判断归属时可以用一句话：如果改动在回答“目录里有哪些模型、配置是否合法”，属于这里；如果在回答“这次怎样调用模型、失败后怎么办”，不属于这里。

---

## 目录与所有权

```text
model-catalog/
├── definitions/                         # domain 公共合同
├── features/
│   ├── catalog-admission/               # 原始配置到合法 ModelConfig 的纯规则
│   ├── cloud-catalog/                   # Cloud 目录 transport、ID 与设备身份
│   ├── default-catalog/                 # credential-free 默认资产与路径合同
│   ├── inference-endpoints/            # 端点准入、credential 密文文件与事务
│   └── user-model-persistence/          # 用户模型文件 envelope 与原子读写
├── registry/                            # 来源合并、内存索引、CRUD、retry 与事件
├── index.ts                             # 唯一跨 domain 入口
└── README.md
```

各层职责固定如下：

| 层               | 可以做                                           | 禁止做                                   |
| ---------------- | ------------------------------------------------ | ---------------------------------------- |
| `definitions/`   | 类型、DTO、diff、窄 port                         | 文件 IO、HTTP、SDK 调用                  |
| `functions/`     | 解析、校验、规范化、稳定 ID 等纯规则             | 修改 registry、发网络请求                |
| `orchestration/` | 单一来源的 IO 流程                               | 拥有全局目录、决定业务 fallback          |
| `registry/`      | 合并来源、内存索引、目录事务、事件与 Cloud retry | Provider 请求、Renderer 状态、Agent 策略 |
| `assets/`        | 可发布且不含凭据的只读目录事实                   | 本机密钥、用户选择、运行时缓存           |

Feature 内部文件不得被其他 domain 深层导入。外部调用方只能从
`src/domains/model-catalog` 导入；直接验证 Cloud
transport 的跨端测试可以指向内部入口。生产代码需要新能力时，应先把真正稳定的窄能力加入根
`index.ts`，而不是扩大内部可见面。

---

## 四个目录来源

### Default catalog

唯一源码资产是
`features/default-catalog/assets/default_models.json`。它只包含模型元数据、typed
route 和显式环境变量 credential reference；不得出现 `api_key`、`api_key_env_var`
或静态密钥。Web Search / Web
Read 的搜索引擎、Reader 和凭据属于 Web 工具域，不得以 `web_search` / `web_read`
伪模型进入本目录。

开发环境由 Electron App
lifecycle 从启动 cwd 所代表的仓库根解析该源码资产；`app.getAppPath()`
在开发命令中只代表 bundle 入口目录，不能作为源码根。发布构建把同一文件复制到
`dist/domains/model-catalog/default_models.json`，发布态从 `app.getAppPath()`
精确解析。App 必须在 Backend 和 Worker 启动前把一条真实存在的绝对路径写入
`MODEL_REGISTRY_DEFAULTS_PATH`。Registry 只消费这条事实，不搜索 cwd、asar、历史目录，也没有
`require` fallback。

完整 App 或企业部署可以显式提供另一条已存在的绝对路径。相对路径和不存在的路径直接拒绝，因为它们不能在 Main、Backend 和 Worker 之间保持同一身份。

### Cloud catalog

Model Catalog 使用 Desktop Host 经严格 bootstrap 传入的发行身份，不再读取
`LINNYA_DEV_MODE` 判断 Cloud。`source` 和 `community` 不加载 Cloud catalog，也不安排后台
重试；只有发行清单验签通过的 `official` 保留 Cloud 客户端接入边界。当前正式发行 key
ring 为空，因此源码运行和本地打包都只使用 default/user/BYOK 模型。发行身份不是服务端
授权；账号 token、entitlement 与计量完成前 Cloud 数据面继续独立关闭。

Cloud transport 启用时，每次只执行一次 `/v1/models` 请求，并把公开模型映射为本地
`cloud-` ID。公开项必须直接给出 `client_base_url` 和完整
`client_*_route`；桌面不再根据 Cloud
alias、展示 provider 或上游厂商拼 URL。Cloud route 的 `endpoint_id`
表示客户端下一跳
`linnya-cloud`，不泄露 Cloud 私有上游。非法条目不会进入目录；整包没有合法条目时结果标记为失败。官方发行态首次网络失败不阻断本地/default/user 模型启动，registry 只对 Cloud 来源安排后台重试。

Cloud 成功快照会原子替换旧 Cloud 模型、更新 purpose
defaults 并发布刷新事件。事件 payload 不是第二份目录；Renderer 收到 Electron 信号后仍从 HTTP
API 重新读取目录。

未来 Cloud 改造成开源 API 网关时，只替换 Cloud 数据面、管理面和必要的本 feature
transport。桌面 `ModelConfig`、本地持久化、Provider runtime 与 Linnkit canonical
contract 不因此合并。上游 endpoint、真实模型 ID、认证方式和 host
credential 只属于 Cloud 私有记录，不得进入本 domain 的公共 Cloud DTO。

### Account catalog

账号型产品可通过 `replaceAccountModels(accountId, models)`
向当前进程投影额外能力模型。这类条目必须声明
`catalog_source: account`，并以匹配账号 ID 的 `provider_account` credential
reference 指向账号凭据边界；不能引用用户 InferenceEndpoint。投影按账号原子替换，授权恢复时重建，退出登录时删除。

Account
catalog 不写入 Workspace，也不成为第二份账号或模型注册表。当前 ChatGPT 订阅在这里投影独立的
`gpt-image-2` 图片模型；可发现的对话模型仍由 Provider
Onboarding 按正式模型注册流程管理。目录只保存引用，OAuth token 的读取与刷新属于
[`provider-account`](../provider-account/README.md) 和 Host model-request-auth。

### User catalog

用户模型和 InferenceEndpoint 元数据写入 Workspace 下的
`user_models.json`。当前 envelope 版本是 `4.0.0`；用户模型显式声明
`catalog_source: user` 并只保存 `inference_endpoint_id`，端点保存 route
profile、endpoint identity、base URL、auth profile 和 credential
reference。模型中不存在 `provider` 字段：用户填写 URL、API
Key 和 API 格式是在配置一个推理端点，不是在创建 Provider。损坏、未知版本或旧
`1.0.0`/`2.0.0`/`3.0.0`
文件在持久化边界直接失败，不能等到 catalog 合并中途才暴露，也不能返回空数组后在下一次保存时覆盖用户文件。

用户密钥不属于 Workspace。`endpoint_credentials.json` 固定写入 AppData
`config/`，只保存系统安全存储密文并使用 `0600` 文件权限。App composition
root 负责安装加解密 codec；Model Catalog 不 import Electron。环境变量和 Linnya
Cloud host credential 仍使用显式 reference，不复制到该文件。

用户模型必须引用一个 InferenceEndpoint，default/Cloud 模型不得引用用户端点。端点与模型 route 的 profile、endpoint
identity、base URL 和 auth profile 必须完全一致。App
composition 提供异步 codec；启动时密文一次解入 App
Server 内存，推理热路径仍同步解析且不跨进程。单条密文无法解密时，InferenceEndpoint 仍保留并投影为 `unavailable`，
请求前由 credential resolver 拒绝使用；重新提交 Key 后才替换旧密文并恢复 `configured`。这类凭据状态不会阻断
App Server 启动。InferenceEndpoint 没有独立的用户生命周期：删除一个模型后仍有其他模型引用就保留；删除最后一个引用模型时，端点元数据和对应密文必须在同一目录事务中自动清理。新建模型时，credential 密文、端点元数据和模型引用同样按一个业务事务提交；目录写盘失败时撤销刚创建的密文，不留下半端点。

正式 Provider connection 的 `ConfiguredProvider`/`ConfiguredProviderModel`
与本文件分属两个 domain。跨文件注册和删除由 application use
case 先持久化包含品牌/connection identity 的 intent，再修改 Model
Catalog，最后提交归属；进程中断后只按稳定 `model_config_id` 与
`inference_endpoint_id` 恢复，禁止用 URL、模型名或 endpoint 文案补猜。Custom
API 不进入该归属边界。

通用 Model
Router 只提供查询、编辑和删除，不接受 Renderer 构造的任意 model/route/endpoint 注册负载。正式 Provider、Custom
API 和 Ollama 分别经过自己的 Host onboarding
workflow；workflow 只向本 domain 提交已决定好的 `ModelConfig`
与 InferenceEndpoint selection。这保证 Renderer 无法绕过 Provider
membership、credential 生命周期和 typed route 准入。

Registry 串行执行用户注册、增、改、删和 diff 的完整事务，从读取当前目录到凭据与文件提交均属于同一队列；
一条事务失败不会阻塞后续事务。每次先计算下一快照，再写入临时文件并 rename，只有成功后才发布本次变更。
内存发布按事务前后差异应用，保留写盘期间发生的其他账号/Cloud 投影变化，不能用旧的整份 Map 覆盖当前目录。
这样后台模型同步与用户编辑不会互相覆盖，也不会出现“接口报告成功但重启丢失”或“磁盘失败、当前进程却继续使用幽灵模型”的分叉。

旧用户模型缺少当前 typed
route 时不进入运行时。当前开发期升级不提供 adapter、URL 或 model-name
heuristic，也不做兼容回填；需要保留的数据应通过一次性迁移转成 v4，再按真实 API
surface、token
limits 与 continuation 能力验证。运行时不能靠双读或启动 fallback 掩盖旧格式。

这里的 `catalog_source`
只表达目录归属，不表达商业 Provider。Codex 套餐等带账号、额度或 token
plan 的服务必须由独立 Provider/account domain 拥有身份，再通过窄合同向 Model
Catalog 投影能力模型和 credential
reference；不得复用 InferenceEndpoint 或恢复模型顶层 `provider`
字段来承载账号产品语义。

---

## 准入规则

- `chat`、`embedding`、`rerank`、`image_generation`、`document_ocr` 与
  `audio_transcription` 必须分别拥有自己的严格 route；
- route 的 `endpoint_model_id`
  必须等于该 endpoint 实际接收的模型 ID，`endpoint_id`
  必须等于本次客户端下一跳；typed route 的 `base_url`
  是模型请求地址的唯一真相源，用户模型还必须与其 InferenceEndpoint 完全一致，Cloud
  transport 则必须与服务端明确下发的 `client_base_url` 一致；
- route capability 必须来自共享 schema 已批准 profile，不能输入 `legacy:*`
  或未注册字符串；
- capability 只表达产品可用能力，不替代 route；一个能力不能借用另一个能力的协议合同；
- 用户 credential 只允许出现在一次连接创建命令中；系统模型使用显式
  `credential_reference`，日志只允许记录缺失的环境变量名；
- reasoning 档位使用 Linnkit 共享合同，不能扩大为任意字符串；
- 模型的 reasoning 能力由显式目录事实优先、模型名推断兜底；推断结果必须以对应
  Provider codec 已验证的实际档位为准。例如当前 Ollama codec 对 GLM-5.3 系列只公开
  `low` / `high`，不能把 Ollama 文档中的 `max` 未经 codec 支持就直接暴露到 UI；
- Cloud、本地默认和用户模型走同一个
  `processModelConfig`，不得各维护一份相似校验。

Model
Catalog 不再保存或归一化顶层通用 API 地址。用户输入地址的格式处理属于对应 onboarding
command；进入目录后，language/embedding/reranking/image/OCR/ASR 只读取各自 typed
route。通用 `adapter` 已删除，禁止恢复地址或字符串启发式选路。

模型目录不存储通用请求头。Language inference 与 remote token
count 通过同一个 Host model-request-auth 边界按请求解析凭据及 Linnya
Cloud 设备身份；Web 外部服务由 Web domain 自己拥有认证合同。禁止在 `ModelConfig`
恢复 `extra_headers` 或其它任意 header map。

---

## 依赖规则

- Electron route、App Host、Parser、Knowledge Base、Graph 和工具只能依赖根
  `index.ts`；
- 本 domain 可以依赖共享 route schema、Logger、底层 path infrastructure 和 Cloud
  HTTP；
- 本 domain 禁止 import Electron、Renderer、AI SDK、Agent registry、Knowledge
  Base 或具体业务 feature；
- Model inference
  Host 读取本 domain 已准入的 route/credential/header，但本 domain 不反向查询 Host
  capability；
- `registry/` 不是全局上帝对象，不新增 SDK client、网络重试策略、业务选择或 UI
  projection；
- 没有两个真实 consumer 的代码不放入 domain `shared/`，当前目录不设 `shared/`。

---

## 开发流程

### 新增默认模型

先确认对应 Provider surface 已在共享 schema 和 Host
capability 中通过 conformance，再修改默认资产。默认条目只引用环境变量名。运行 catalog
admission 测试、边界 guard、Main/Backend
build 和默认资产复制检查；涉及正式 Provider 时再运行 Proposal 规定的 codec/packaged
smoke。

### 新增或修改 route

按“共享 schema → catalog admission → Host capability → Renderer route producer →
default/Cloud 配置”的顺序修改。只改 catalog JSON 或 Provider 下拉项不算完成。

### 修改用户模型格式

先说明新版本为何必要，并决定是否接受不兼容清理。当前不维护多版本 reader；若业务明确要求数据迁移，应提供独立、一次性、可验证的迁移步骤，不能把双读长期留在运行时。

### 修改 Cloud 目录

Cloud v2 存储记录在服务端分为公共 `catalog` 与私有 `upstream_route`；Cloud
API、Admin producer、Worker 公共投影、桌面 fetch 和 Renderer
projection 必须使用同一公开 wire 合同。测试需覆盖合法条目、非法整包、purpose
defaults、能力保真、桌面不拼 URL，以及 credential/upstream 字段绝不下发。存量 Cloud
KV 只通过 `scripts/cloud-model-kv-v2-migration/`
迁入新 namespace，不在本 domain 增加 v1 双读。

---

## 测试与门禁

优先测试目录业务事实，不测试 README、日志文案或 JSON 字段快照。

| 范围                | 必测事实                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Catalog admission   | route/identity 一致性、capability、reasoning、credential 引用                                                                 |
| Default path        | 只接受已存在绝对路径、开发/发布资产唯一选择、缺失时失败                                                                       |
| Cloud catalog       | 单请求、typed route、非法 payload、purpose defaults、能力保真                                                                 |
| User persistence    | v4 envelope、端点引用、损坏文件失败、原子写入                                                                                 |
| Endpoint credential | 只写密文、跨启动解密、`0600`、删除同步落盘                                                                                    |
| Registry            | 来源优先级、端点/模型一致性、端点复用、最后引用删除时清理端点与密文、Cloud 替换/retry/event、写盘失败不提交内存并撤销密文变更 |
| Electron bridge     | renderer-ready 前后刷新信号不丢失，payload 不成为第二目录                                                                     |

日常至少运行：

- `pnpm exec vitest run src/domains/model-catalog`
- `pnpm run guard:model-inference-boundary`
- `pnpm run guard:tsc-baseline`
- `pnpm run build:main`
- `pnpm run build:backend`

修改默认资产或打包路径时，还必须验证复制产物位于
`dist/domains/model-catalog/default_models.json`，并按启动/打包手册运行当前平台 packaged
smoke。单纯目录重构不需要等待 Windows/macOS 正式签名安装包发行门禁。

---

## 禁止事项

- 恢复 `src/model-registry`、`Registry`、`registry` 或 `getModelById` 兼容入口；
- 从源码目录读取 `.env`，或把开发机密钥复制进默认资产/发布包；
- 搜索多个 cwd/asar/历史候选后“找到哪个用哪个”；
- 默认文件缺失后 `require` 内置 JSON，或用户文件损坏后返回空目录；
- 在持久化失败后仍提交内存模型；
- 把 credential 明文、密文或完整注册命令返回给 Renderer，或写入 Workspace；
- 让用户模型绕过 InferenceEndpoint，或让同一 endpoint 与不一致 route 绑定；
- 把自定义 URL/API Key/API 格式保存成 Provider 实体，或在 `ModelConfig`
  恢复无明确语义的 `provider` 字段；
- 按 Provider、URL、模型名或通用 `adapter`
  猜 language/embedding/reranking/image/OCR/ASR route；
- 把 Vercel AI SDK registry 与产品 Model Catalog 合并；
- 恢复通用 `POST /api/v1/models` 或 Renderer
  endpoint 目录 API，让 UI 直接构造内部 route；
- 为未来 Cloud API 网关预埋空 manager/service、重复 DTO 或运行时 fallback；
- 外部 domain 深层导入 feature 内部实现。

若需求与这里的 owner 或依赖方向冲突，先更新 Proposal 与本 README，把职责变化讲清楚，再修改代码。
