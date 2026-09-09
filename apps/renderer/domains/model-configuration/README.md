# Model Configuration Renderer Domain

`model-configuration` 是 Renderer 中“模型服务 / Models &
Providers”的唯一业务 owner。它管理桌面后端 Provider/模型目录的前端投影、正式 Provider 模型注册、自定义 API 配置、Ollama 本地模型注册，以及各产品用途的模型绑定。正式 Provider 的 URL、鉴权、容量和 runtime
route 不在 Renderer 决定。

Settings 中的产品边界必须保持为三个独立任务：`添加模型`
负责选择 Provider 并完成接入，`模型管理`
负责快捷选择器可见性与自定义模型详情编辑，`模型配置`
只负责主模型和各业务用途绑定。Provider 是“添加模型”页内的来源选择，不是 Settings
Tab 名称。三者同属一个 domain，但不得因此混成同一个 Settings
Tab，也不得在“模型配置”重复提供模型管理入口。

Settings 只注册这里公开的设置页面；Conversation、Knowledge Base、Editor 和 app
workflow 只能消费本 domain 的公开合同，不能自行读取模型目录内部状态。

> Provider 产品目录与发布状态的长期合同见
> [`packages/provider-catalog/README.md`](../../../../packages/provider-catalog/README.md)；推理执行、Provider SDK、conformance 和 usage 审计的长期合同见
> [`src/app-hosts/linnya/adapters/inference/README.md`](../../../../src/app-hosts/linnya/adapters/inference/README.md)
> 与
> [`packages/linnkit-provider-ai-sdk/README.md`](../../../../packages/linnkit-provider-ai-sdk/README.md)。本 README 只约束 Renderer 配置域。

---

## 修改前先看哪里

| 要改的内容                                    | 先看                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端模型列表 DTO、加载、增删改                | `features/model-catalog/`                                                                                                                   |
| 后端 Provider 公开目录 DTO                    | `features/provider-catalog/`；跨端 schema 位于 `packages/schemas/src/provider-catalog/`                                                     |
| 快捷选择器可见性与分组投影                    | `features/model-picker/`；Host use case 位于 `src/app-hosts/linnya/application/model-picker/`                                               |
| 正式 API-Key Provider 接入                    | `features/direct-provider-onboarding/`；后端 workflow 位于 `src/app-hosts/linnya/application/provider-onboarding/`                          |
| 正式账号型 Provider 授权与模型注册            | `features/provider-account-model-registration/`；授权 Host use case 位于 `src/app-hosts/linnya/application/provider-account-authorization/` |
| 已有模型的容量解析与 route 编辑               | `features/inference-endpoints/`                                                                                                             |
| 自定义 API 新增模型                           | `features/custom-model-registration/`；Host use case 位于 `src/app-hosts/linnya/application/custom-api-onboarding/`                         |
| Ollama 本地模型发现与注册                     | `features/ollama-model-registration/`；Host use case 位于 `src/app-hosts/linnya/application/ollama-onboarding/`                             |
| 统一 Provider 选择与三条注册路径组合          | `ui/ModelRegistrationSettingsPage.vue`；具体表单归各 feature 的 `ui/` 所有                                                                  |
| 主模型、辅助用途、Embedding/OCR/图片/转录绑定 | `features/purpose-model-bindings/`                                                                                                          |
| 删除模型后的跨 feature 清理                   | `orchestration/deleteConfiguredModel.ts`                                                                                                    |
| Knowledge Base 对嵌入模型切换的影响检查       | `ports/embeddingModelChangeImpactPort.ts` 与 Knowledge Base registration                                                                    |
| Settings 如何嵌入页面                         | `domains/settings/README.md`                                                                                                                |
| route wire schema                             | `packages/schemas/src/model-inference/`                                                                                                     |

---

## 负责与不负责

### 负责

- 从本地 Host HTTP API 读取模型目录，并解析成严格的 Renderer DTO；
- 处理模型目录的加载、编辑、删除和主进程刷新信号；
- 校验自定义 API 的用户输入，并把格式、URL、Key、model
  id、容量和视觉声明作为窄 command 提交给 Host；
- 把正式 Provider 与目录模型作为窄 command 交给 Host onboarding
  workflow；API-Key
  Provider 单向提交 Key，账号型 Provider 只触发浏览器授权并读取非敏感连接状态；
- 把 Ollama 服务地址、模型 ID 和容量作为窄 command 交给 Host onboarding
  workflow；
- 只单向提交 credential，不把 secret 写入 Pinia、localStorage、目录 DTO 或日志；
- 保存用户显式模型选择，并从目录和默认配置派生有效绑定；
- 消费 Host 组合的 Model
  Picker 快照，在“模型”Tab 管理 Provider/模型快捷选择可见性；
- 对外提供稳定的只读查询、同步选择命令、设置页面和跨域 port。

### 不负责

- Vercel AI SDK
  Provider 创建、推理调用、重试、fallback、continuation、usage 或审计；这些属于 Host
  inference capability；
- Conversation 的会话级 Agent 选择、消息生命周期或 SSE 投影；
- Knowledge Base 索引重建规则、文档数量计算或数据访问；
- Cloud catalog、KV、Admin 或未来 FastAPI/API 网关的实现；
- ASR、文档 OCR 等非语言模型 runtime adapter；
- 保存或回显明文 credential。

如果一个改动需要判断“怎么请求模型”，它不属于这里；如果它判断“用户配置了哪个模型、该配置如何形成合法 route”，才属于这里。

---

## 目录与所有权

```text
model-configuration/
├── features/
│   ├── provider-catalog/           # Provider public HTTP DTO、只读状态与加载编排
│   ├── direct-provider-onboarding/ # 正式 Provider 的 Key-only 首次接入
│   ├── provider-account-model-registration/ # 正式账号型 Provider 的授权与模型注册旅程
│   ├── inference-endpoints/       # token capacity 解析与已有 route 编辑校验
│   ├── model-catalog/              # HTTP DTO、目录 read model、CRUD 与目录 UI
│   ├── model-picker/               # Host 组合菜单快照、可见性命令与 Renderer 生命周期
│   ├── custom-model-registration/  # 自定义 API 注册表单与提交流程
│   ├── ollama-model-registration/  # Ollama 发现、注册表单与提交流程
│   └── purpose-model-bindings/     # 用途定义、选择持久化、有效绑定派生与选择 UI
├── orchestration/                  # 跨 feature 流程，只做步骤编排
├── ports/                          # 跨 domain 的窄合同与注册点
├── ui/                             # 只组合多个 feature 设置区，不持有各表单业务状态
├── index.ts                        # 其他 domain 唯一允许依赖的入口
└── README.md
```

各层职责固定如下：

| 层                | 可以做                                      | 禁止做                                      |
| ----------------- | ------------------------------------------- | ------------------------------------------- |
| `definitions/`    | DTO、schema、command、port、枚举            | HTTP、Pinia 写入、业务流程                  |
| `functions/`      | 解析、过滤、默认值、能力判断等纯规则        | 网络、弹窗、store 写入                      |
| `store/`          | 保存状态并提供同步原子 action               | HTTP、IPC、跨 store 编排、业务规则          |
| `infrastructure/` | 实现 HTTP/IPC/外部系统 port                 | 决定产品默认值、直接操作 UI                 |
| `orchestration/`  | 调用网关、纯函数和同步 action，安排步骤顺序 | 复制计算规则、渲染 UI                       |
| `ui/`             | 展示、交互、连接公开 read model/action      | 解析 wire、直接调用其他 domain 内部 service |

Feature 之间只能依赖对方的
`index.ts`，不能深层导入内部文件。跨 feature 的原子业务流程放到 domain 根
`orchestration/`，不要塞进任意一个 store。

`ModelRegistrationSettingsPage`
只拥有页面级“供应商品牌 → 接入方式”选择状态。首次进入时先展示 OpenAI、OpenCode Go、Ollama Cloud、Kimi、Claude 五个常见供应商，并提供“其他供应商”下拉和“自定义 API”入口；选择后进入现有接入详情，保留顶部 Provider 下拉。一个品牌只有一条可用 connection 时直接进入 setup，多条时用
`SettingsChoiceGroup` 展示带说明与标签的选择卡。页面按 connection setup
schema 只挂载当前选择对应的 API-Key、账号授权、本地 runtime 或自定义表单，并只把
`provider_connection_definition_id`
传给 feature。每条注册路径的表单状态、校验提示、提交编排和生命周期仍留在所属 feature，组合页不得形成上帝组件。未选择 Ollama 时不得提前连接本地 Ollama 服务，未选择账号型 connection 时不得读取授权状态。onboarding 成功后统一调用 domain-level
`refreshModelCatalogAfterRegistration`，只重读 Renderer 真正消费的模型事实源。

---

## 核心能力

### Inference endpoints

后端采用
`ModelCatalogEntry → InferenceEndpoint → CredentialReference`。`InferenceEndpoint`
是 Host 内部的 route/credential 复用边界，不是用户可选择或命名的 Provider，也不再通过 Renderer
HTTP
API 投影到 Pinia。正式 Provider、自定义 API 与 Ollama 的 URL、鉴权、endpoint
identity 和 route binding 分别由各自 Host onboarding workflow 决定。

Renderer 的 `inference-endpoints` feature 只保留两类纯规则：模型 token
capacity 输入解析，以及编辑已有模型时对原 typed route
identity 的保留/重新校验。它不读 endpoint 目录、不创建 route、不复制 Host 的 endpoint 复用规则。禁止靠模型名、URL 或
`provider` 字符串猜协议，也禁止恢复任意 capability id 输入框。

### Provider catalog

`features/provider-catalog` 只从 `GET /api/v1/providers` 加载严格 public read
model，并通过共享 `@app/schemas/provider-catalog`
解析。store 只保存 generation、Provider 数组、加载状态和安全错误；不保存用户选择、credential、route
profile 或 runtime
binding。Provider 页面和正式 Provider 表单必须读取这份状态，不能再复制厂商 membership。

Host 私有 package、base URL、auth 和 route
binding 不进入 Renderer。Provider 名称和模型 membership 没有 Renderer 枚举或 i18n 副本；增加一个已有 adapter
profile 的 simple direct Provider 不需要修改 Vue 分支。

### Model picker product boundary

`features/model-picker` 只消费 Host
`ModelPickerSnapshot`：Cloud、已配置正式 Provider 与自定义模型的归属、凭据可用性、runtime 可用性和 picker 可见性已经由 Host
app workflow 组合完成。Renderer 不允许再读取 URL、`catalog_source`
或模型名前缀推断 Provider。

所有对话模型选择菜单统一使用 `Linnya Cloud`、`模型供应商`、`自定义模型`
三个来源分组。输入框快捷菜单、设置中的主模型和辅助对话模型都必须消费同一份
`ModelPickerSnapshot`：Cloud 与自定义模型直接展开，正式 Provider 按稳定品牌 ID 聚合为“品牌 → 模型”单层子菜单。跨 connection 只有同名模型发生歧义时才加 connection 后缀，最终选择仍保存具体 ModelConfig
ID，不按名称随机选择 route。模型管理保留具体 ConfiguredProvider
connection；同一品牌配置多条 connection 时显示接入方式标签。图片生成模型复用同一 Provider 分组：Cloud 图片模型归
`Linnya Cloud`，账号图片模型归对应正式 Provider。Embedding、OCR、转录等其他用途仍消费自己的目录投影。

“模型管理”设置页负责 Provider/模型的选择可见性；开关不删除 credential、endpoint、ModelConfig 或用途绑定。正式 Provider 的未激活目录模型通过公开 activation
command 复用现有 credential，不能再次向用户索要 Key。对话域只能从本 domain 公开入口读取 picker
read model，具体菜单层级、图片草稿禁用态和“管理模型…”交互属于 Conversation。

模型管理的开关层级由来源语义决定：正式 Provider 在详情标题提供总开关，关闭后其模型区域整体不可编辑；每个模型仍有独立开关。自定义模型没有伪造的 Provider 总开关，只提供单模型开关；点击自定义模型主内容打开详情弹窗，编辑与删除复用 Model
Catalog 的正式流程。Linnya
Cloud 是官方管理的优先来源，客户端不显示 Provider 总开关，也不显示单模型开关；Cloud 模型的上架、下架和可用性由 Cloud
Model
Catalog 统一控制。图片生成默认模型也必须由 Cloud Catalog 以 `image_generation` capability 发布，客户端不得把本地环境变量模型改名伪装成 Linnya Cloud。Cloud 与正式 Provider 模型行都不提供详情点击入口。左侧来源导航只负责选择详情，不承载开关或启用数量。

删除模型时，Host app-level removal workflow 在 Model
Catalog 删除成功后同步删除 picker 稀疏偏好，再提交正式 Provider 归属删除；后两步失败均不能把已经成功的模型删除伪装成失败，分别由启动 reconcile 或 durable
intent 恢复。

### Direct Provider onboarding

`features/direct-provider-onboarding` 首次接入只提交
`provider_connection_definition_id` 与 API
Key，并解析稳定的 onboarding 响应/错误 DTO。Host 自动启用公开目录中最多三个近期模型（稳定版优先）；其余目录模型只在“模型管理”中按需激活，不要求用户在接入时逐个选择。品牌 ID、容量、视觉能力、URL、auth、API
surface 和 capability id 不进入 command；后端 application use
case 从 connection 反查品牌，并从同代 public catalog/private
binding 投影严格 route，再通过 Model
Catalog 保存共享 credential、endpoint 和模型归属。API-Key 表单的帮助入口来自 connection
catalog，不在 Vue 中维护厂商 URL 表。

同一 ConfiguredProvider 下继续激活模型时复用原 endpoint/credential
boundary，且只允许从模型管理发起。已连接的直连 Provider 不再出现在“添加模型”页。API-Key
feature 不伪造多账号、也不把 Key 放进 store 或日志；OAuth/device-flow 产品进入独立 ProviderAccount 用户旅程。

### Provider Account model registration

`features/provider-account-model-registration`
拥有账号型正式 Provider 的 Renderer 用户旅程。当前 ChatGPT 只显示“使用 ChatGPT 登录”，调用 Host 的 Craft 同款浏览器 PKCE 授权；Renderer 只能读取 connected/disconnected 状态，不能接触 access
token、refresh token、account claim、Codex backend 或 Responses route。表单只用
`provider_connection_definition_id` 从 feature 内的窄授权 registry 解析通用
`getStatus/authorize/disconnect`
动作；ChatGPT 协议和 HTTP 路由留在自己的 adapter，新增账号型 connection 必须注册独立实现，不能在 Vue 中增加供应商分支。授权完成后，Host 自动从当前账号的 Codex
`/models`
动态发现模型，再沿正式 onboarding 主链注册或刷新模型，并把稳定 ProviderAccount 引用写入共享 endpoint；Renderer 立即重读模型目录与模型选择投影，不再显示逐模型“添加”表单，也不保存一份静态 ChatGPT 模型列表。Provider 和模型的启用范围统一在“模型管理”Tab 调整。

退出登录只删除本机授权凭据，不静默删除 ConfiguredProvider、模型、用途绑定或快捷选择偏好；重新登录后相同 account
identity 可以恢复请求。模型目录、授权状态和模型配置继续由三个独立 owner 管理，Renderer 不保存“已登录”镜像到 Pinia 或 localStorage。

### Model catalog

目录以 `GET /api/v1/models` 为唯一事实源。主进程 `models-updated`
只是 Cloud 目录变更后的重新读取信号，事件 payload 不是第二份目录数据。本地自定义 API、正式 Provider 与 Ollama 注册不依赖该信号，注册完成编排必须主动重读模型目录。

`modelCatalogStore` 只保存已解析模型、当前操作、结构化错误、purpose
defaults 和 Cloud 目录确认状态。它不持久化，也不执行网络请求。HTTP 网关只接受当前包装对象 wire；旧数组响应不会双读。增删改 orchestration 先调用网关，成功后再提交同步 store
action。

自定义 chat 模型详情允许编辑 `context_window_tokens` 与
`max_output_tokens`。UI 只持有字符串草稿；纯函数统一校验为正安全整数，并与模型身份、endpoint、route
profile 和图片输入能力一起生成一次原子的 `inference_route` 更新。不得在 catalog
store、Conversation 或 Settings 中保存第二份容量。

### Model picker state and operations

`features/model-picker` 只消费 Host 的 `GET /api/v1/model-picker`
组合快照，并提交按 `configured_provider_id` 或 `model_config_id`
索引的可见性命令。Renderer 不按 URL、模型名、endpoint 或 catalog
source 猜正式 Provider；Cloud、正式 Provider、自定义模型和 runtime
availability 已由 Host 一次投影完成。

当正式 Provider 的本机凭据不可用时，快照会同时返回受控的
`credential_unavailable_reason`（缺失、系统安全存储暂不可用、密文失效/格式错误或未知错误），Settings
以错误色展示具体原因，并提供“删除凭据并重新添加”操作。该操作通过 domain-level
模型删除编排清理 Provider 的已激活模型、孤儿 endpoint 与本机密文，不在 Renderer 直接访问凭据文件。

store 只持有最后一次严格解析后的快照、当前操作和结构化错误。HTTP、更新流程和同步 state
action 分别位于 infrastructure、orchestration 和 store。新增目录模型不会在 Renderer 生成默认偏好；尚未 materialize 的正式 Provider 模型只服务 Settings 全目录，不进入快捷选择候选。

模型目录注册、Provider 目录模型激活、删除或 Cloud 更新后必须同时重读 model catalog 与 model picker read
model。快捷可见性与用途绑定互不覆盖：关闭显示不清空 primary/辅助/Embedding/OCR 等绑定。Cloud 模型上下架由 Cloud
Model Catalog 在发布前控制，客户端不再镜像一个恒真的 `ModelConfig.enabled`。

Provider 目录模型激活虽然从 picker 设置界面发起，但 Host 会创建新的 ModelConfig，因此 Renderer 必须通过 domain 根
`orchestration/activateConfiguredProviderModel.ts` 完成跨 feature 编排。model-picker feature 只提交激活并接纳新的 picker
快照，UI 不得直接调用它后跳过 model catalog 刷新。

图片输入开关表达模型本身能否理解图片，不是让用户编辑 Provider placement。Host 注册或更新模型时，将这个语义能力
分别与 route profile 的 `user_image`、`tool_result_image` 相交；设置页只提供统一的“支持视觉识别”语义开关，不展示 route
级图片来源差异。因而
Chat-only endpoint 可以让多模态模型接收用户附件，而不承诺读取工具返回图片。关闭图片输入后两个有效位置都关闭。
图片生成是独立工具能力：生成、保存和 Renderer 展示不依赖当前聊天 route；只有把结果继续交给模型时才要求
`tool_result_image`。模型选择器与 Composer 只消费 `image_input + user_image`，不因工具图片位置缺失而隐藏模型或阻止发送。

### Custom API model registration

根 `ModelRegistrationSettingsPage`
只负责统一选择并条件挂载自定义 API、Ollama 和正式 Provider 三个独立 feature，不读取或合并表单内部状态。自定义 API 编排只校验用户输入并提交共享 strict
command，Host use case 生成内部 route 后通过 Model
Catalog 原子保存。它要求 URL、首次配置所需的 API
Key 和三选一兼容格式；相同 URL 与格式已有凭据时可留空复用。它不要求用户命名一层“连接”，也不会把 URL
host 当成 Provider 名称持久化。

填写自定义 API 地址时，用户按服务文档选择三种 API 格式：`OpenAI 兼容` 对应
`openai_compatible_chat` 与 `/chat/completions`，`OpenAI Responses` 对应
`openai_responses` 与 `/responses`， `Anthropic 兼容` 对应
`anthropic_messages`。行业通常所称的 OpenAI-compatible 默认指 Chat
Completions；Responses 必须明确选择，不能从模型名、URL 或返回错误自动猜测。Responses、Messages、capability
id 和 route profile 都是内部实现，不要求普通用户手填。

用户只填写协议服务域名时，共享 command 规则自动补全该协议的 `/v1`
基线路径；用户已经填写任何路径时必须保留，只统一去掉末尾斜杠。Renderer 与 Host
共同复用这条规则，endpoint 复用和持久化不允许出现另一套 URL 规范化。

三种格式都允许用户声明模型的图片理解能力，但 route 只开放自身 codec 经过 conformance 的来源。OpenAI-compatible
Chat 不能原生表达带图片的 tool result，因此投影为 `user_image=true / tool_result_image=false`；它不会把工具图片改写成
额外 user 消息。OpenAI Responses 与 Anthropic Messages 当前可投影两个来源。自定义 API 允许 HTTP 与 HTTPS，以支持
公司内网和本地服务；这里不替用户制定网络边界策略。Ollama 原生 Chat 不属于 OpenAI-compatible Chat：其正式
Provider package 可以把工具结果图片编码为原生 tool message，因此 `ollama_chat` profile 开放两个图片来源。能力仍由
profile 决定，不能从品牌或模型名猜测。

添加与编辑共用 inference-endpoints feature 的 token
capacity 解析规则。新增 API 模型的表单初始值为 256K 上下文窗口和 16K 最大输出，仍由用户按实际部署修改；它们不是模型能力推断。配置输入真正缺失时，共享 route
schema 使用同一组 `256000 / 16384` 缺省并输出完整 canonical
route；非法显式值继续失败。输入与输出两个值是 route 的独立能力事实：Renderer 不假设所有 Provider 都满足同一种窗口关系，也不从模型名猜默认值。后续若增加自动发现，必须作为 Provider-specific
capability 明确接入，不能把某一家 `/models` 响应当成通用合同。

Credential 只允许存在于未提交表单和一次 Custom API onboarding
command 中。Host 将它转换为一次 InferenceEndpoint create
command；模型配置不重复携带 secret，日志只能记录安全错误 code。未提交 Key 时由 Host 按格式、规范化 URL、认证和 endpoint
identity 决定能否复用，Renderer 不读取 route/auth 来复刻该规则。

### Ollama connections

公开目录把 Ollama 表示为一个品牌、两个 connection：`Ollama 本地`负责本机或局域网运行时，
`Ollama Cloud` 负责官方 Cloud API Key。组合页只复用既有接入方式选择：Cloud 进入正式
API-Key Provider onboarding，本地进入下面的模型发现流程；不得为 Cloud 复制表单、模型列表或
Provider 状态。Cloud 的模型来自正式 Catalog，用户只填写 Key，近期模型自动启用，其余模型在
“模型管理”中选择。

### Ollama local model registration

`features/ollama-model-registration`
拥有本地模型发现、表单和窄提交流程。Renderer 只提交 Provider Catalog 给出的
`provider_connection_definition_id`、HTTP(S) 服务根地址、模型 ID、展示名和 token
capacity；Host 验证该 connection 必须是 `local_runtime`，再反查品牌并生成固定
`openai_compatible_chat` typed
route、无认证 InferenceEndpoint 与 ConfiguredProvider 归属。

当前一个 Ollama
ConfiguredProvider 对应一个服务地址，同地址新增模型复用 endpoint；换成另一个地址时明确拒绝，而不是按 URL 暗中创建第二个 Provider。未来若支持多个 Ollama 实例，必须先定义可见的多实例产品语义。Ollama 是 Provider
Catalog 中的正式本地运行时，不归到“自定义模型”，也不用 URL 猜它的身份。

### Purpose model bindings

该 feature 区分“用户显式选择”和“当前有效模型”：

- 显式选择写入 `modelPurposeBindingsStore`；
- 有效模型由目录、Cloud readiness、purpose defaults 和显式选择实时派生；
- 业务运行入口必须通过公开查询读取有效模型；显式选择只用于设置编辑、持久化和删除清理，不能直接作为运行时模型；
- reasoning effort 使用 Linnkit 共享规则读时降级，不改写用户原选择；
- 删除模型后由根编排清理所有显式绑定。

Store 的 Pinia id 仍为 `models`。这是已发布的 localStorage
identity，不代表目录仍由旧 store 所有；保留它是数据合同，不是运行时兼容分支。旧
`auxiliaryModelId` 单槽位读取已删除，不再维护历史双状态。

---

## 关键数据流

### 启动与刷新

1. app 入口启动 model catalog lifecycle；
2. lifecycle 先注册 `models-updated` 监听，再读取 HTTP 目录；
3. 网关在边界解析 DTO；
4. orchestration 把快照提交到 catalog store；
5. 各用途的 computed read model 自动重新派生。

### 新增、编辑与删除

正式 Provider（包括 Ollama Cloud）新增时，UI 从 public
catalog 选择 Provider 并提交 Key，Host 自动启用少量近期模型；自定义 API 新增时，UI 提交用户明确填写的 URL、格式、模型资料和容量；Ollama 本地新增时，UI 提交本地服务地址、发现后的模型 ID 和容量。三条路径分别进入独立 Host
onboarding
workflow，由 Host 决定 route、endpoint/credential 复用和 ConfiguredProvider 归属，写入完成后统一重读模型 catalog。Renderer 不存储 endpoint
read model，也不能再通过通用 Model
Router 提交任意内部 route。编辑自定义 chat 模型时，详情表单从现有 route 初始化容量，校验后原子提交完整 route；更新成功后的后端 DTO 直接替换 catalog
read model。编辑已有模型时不能改变为与已绑定端点不一致的 endpoint 或 route
profile；后端会在 catalog admission 明确拒绝。

删除时，`deleteConfiguredModel`
先删除后端目录实体和前端 catalog，再清理指向该 id 的全部显式用途绑定。不得在 UI、store 或其他 domain 复制这些流程。

---

## 跨 domain 规则

- 外部 domain 只能从 `@/domains/model-configuration` 导入；
- Settings registry 只能注册本 domain 导出的页面，不能重新拥有表单或规则；
- 本 domain 使用 Settings Kit 时只能依赖 `@/domains/settings/public`；
- Knowledge Base 通过 `EmbeddingModelChangeImpactPort`
  提供影响数据，model-configuration 不导入其 service/store；
- app 入口负责注册跨域 port 和启动 lifecycle；
- shared 只能提供无业务归属的底层能力，例如本地 API 鉴权 client。

`index.ts` 是公开合同，不是“把所有内部文件都导出”。Catalog 对外只暴露
`useModelCatalogReadModel`，可写 store 和 CRUD
orchestration 留在 feature 内部。新增导出前要先确认至少有一个外部 consumer，并优先暴露窄查询或 command，而不是整个可写 store。

---

## 状态与副作用规范

- Catalog store 与 bindings store 都只能执行同步写入；
- HTTP/IPC 必须位于 infrastructure，异步流程必须位于 orchestration；
- UI 通过 action 修改绑定，通过 selector/read model 读取派生值；
- 不存储能够从目录和选择实时计算出的 effective id；
- 不在一个 store 中反向调用另一个 store 的 orchestration；
- 不用 `try/catch + fallback` 掩盖非法 DTO、未知 purpose 或未注册 port；
- 不加入“旧字段还在就顺便读一下”的兼容路径。

真实边界错误应明确失败。输入表单可以返回可展示的业务 issue；wire
schema、未知 route
profile 和未装配 port 则必须抛错，不能静默选择另一个 Provider。

---

## 开发流程

### 新增模型能力或可见性

先确认它是后端目录事实还是 Renderer 展示规则。后端事实进入共享/Host 模型合同并由 catalog
DTO 投影；Renderer 纯展示分组进入 catalog
functions。不要在 Vue 中散写 capability 过滤。

### 新增辅助用途

需要同时完成：在共享 PromptKeys 定义稳定 key，在 purpose
registry 声明默认策略，在 presentation
mapping 提供文案 key，在对应业务 consumer 通过公开查询读取，并增加默认值、显式选择和目录缺失场景的业务测试。

### 新增跨域影响检查

先定义只包含本流程所需字段的 port。提供方在自己的 domain 实现并由 app 入口注册；消费方不能导入提供方内部 service，也不能把对方业务实体整个搬进 port。

### 新增 Provider

已有 Host adapter profile 的 simple direct Provider 只改 Provider Catalog
admission/生成资产、conformance/readiness 与来源/许可证记录；不得新增 Renderer
Provider 枚举、i18n 名称或 Vue 分支。只有真正新增协议/package
capability 时，才先扩共享 route schema 与 Host
capability。只改下拉文案或 provider 字符串不算接入完成。

---

## 测试与门禁

优先测试业务流程和边界，不锁 CSS 值或 README 快照。

| 范围                     | 必测事实                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Catalog projection       | 当前包装 wire、route schema、元数据映射、非法响应拒绝                                                          |
| Catalog operations       | load/update/delete 的状态提交与失败语义                                                                        |
| Purpose resolution       | 显式选择、默认值、Cloud readiness、能力过滤、reasoning 降级                                                    |
| Cross-feature delete     | 后端删除成功后目录与全部绑定同步清理                                                                           |
| Registration             | 三条 Host onboarding command 的窄输入、route/endpoint 的 Host ownership、credential 单向提交、section 独立状态 |
| Inference endpoint rules | token capacity 解析、编辑时 route identity 保留和非法修改拒绝                                                  |
| Cross-domain port        | Knowledge Base 只返回受影响集合，页面只做确认交互                                                              |

日常至少运行：

- `pnpm exec vitest run apps/renderer/domains/model-configuration`
- `pnpm run guard:model-inference-boundary`
- `pnpm run guard:tsc-baseline`
- `pnpm run build:frontend`

提交时还必须通过仓库 pre-commit gate。涉及 Host route、Cloud
catalog 或打包行为时，再按 Proposal 和启动/打包手册扩大验证；单纯 Renderer
domain 重构不要求 Windows/macOS 安装包验收。

---

## 禁止事项

- 恢复 `shared/stores/models.js`、`modelService.js` 或 Settings 内旧模型文件；
- 新建 `manager`、`service`、`utils`、`helpers` 兜住无法归类的代码；
- 从外部 domain 深层导入 feature/store；
- 在 store 中发 HTTP、订阅 IPC 或计算业务默认值；
- 在 UI 直接调用 Knowledge Base、Conversation 等内部 service；
- 记录 credential、完整 registration command 或带 secret 的异常 payload；
- 同时支持新旧 route、旧数组 DTO、旧 auxiliary 单槽位；
- 用 provider/model 名称或 URL 猜 runtime capability；
- 把自定义 URL/API Key/API 格式建模或持久化为 Provider；
- 为“以后可能上 API 网关”提前加入空接口、fallback 或重复 DTO。

边界守卫会阻止旧 Renderer 模型实现和深层 import 回流。若新需求与本文边界冲突，先更新 Proposal/README 并说明 owner 变化，再修改代码。
