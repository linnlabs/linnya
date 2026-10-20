# Provider Onboarding Use Case

本 use case 拥有“从正式 Provider 公开目录创建本地可调用模型”的跨 domain 顺序。它连接
Provider Catalog、Host 私有 runtime binding 与 Model Catalog，但不替任何一方保存第二份真相。

## 公开用例

`configureDirectProvider` 是 Renderer 的首次接入口，只接收 connection ID 和 API Key，并按“稳定优先、发布日期倒序”启用最多三个近期模型。第一项失败代表连接失败；后续默认激活失败不会否定已经可用的 Provider，其余模型留在模型管理中按需调用内部
`registerDirectProviderModel` 激活，不再次索要 Key。账号型 Provider 先由自己的授权 use case 建立
ProviderAccount，注册 command 不携带 token。`synchronizeConnectedProviderModels` 在账号授权完成或
应用启动恢复时读取账户级模型目录，把新模型逐个交给同一注册主链，原位刷新已有 ModelConfig 的容量和能力，并通过统一 durable 删除用例退出已不在账号目录中的历史模型，不另写批量持久化或删除旁路。Renderer
不提交 URL、auth profile、API surface、package、route capability、容量或视觉能力；这些字段分别来自
版本化 Provider Catalog 与 Host 私有 binding。

`replaceDirectProviderCredential` 供模型管理更换已连接 API-Key Provider 的 Key：只接收 connection ID 与新
Key，校验 connection 的 setup schema 确为 API Key 且已存在 ConfiguredProvider，确认其全部 endpoint 共享唯一
`stored_secret` 后，通过 Model Catalog `replaceInferenceEndpointCredential` 在原 credential boundary 内替换密文。
它不新建 endpoint、不改写模型或用途绑定，也不接受 URL、协议等字段；账号型 Provider 继续走登录授权。

API-Key Provider 的 `refreshRegisteredProviderModels` 只原位更新已经激活的 ModelConfig，
复用注册 builder 更新名称、容量与能力，保留现有 endpoint 的协议、URL 与认证，不自动激活或删除模型。
资料优先来自 `application/provider-model-discovery` 本次成功的候选，未发生在线发现时使用 bundled。
已接入在线发现的 connection 在显式刷新时查询官方目录（能力清单见相邻 provider-model-discovery）；启动不再用 bundled 覆盖这些供应商已保存的联网资料。
其余 bundled connection 仍在启动时刷新已激活模型的发布元数据。

模型级 `input_policy` 与 route profile、上游视觉能力共同投影为最终图片来源事实。
已经注册的 OpenCode Go `deepseek-v4.1-flash` 在一次成功的正常“刷新模型”后获得工具图片支持，
沿用原 model、endpoint、URL、auth profile 与凭据；第二次相同刷新不再写入。
Go 的启动恢复不刷新 bundled 元数据，因此仅重启不会保证旧模型采用这项政策。

在线新模型也经过相同 membership 校验、已验收 binding、endpoint/credential 复用和 durable intent。
缺少能力资料的候选只显示在设置页，不能绕过注册准入。外部发现不能修改调用 URL、认证或协议。

## 固定流程

```text
校验 public catalog / private binding generation
  -> 读取正式 Provider 与 bundled model / 已授权 account catalog
  -> 读取已验收 runtime binding
  -> 按 setup schema 选择静态 Key 或已连接 ProviderAccount
  -> 按模型 runtime binding 创建或复用对应 InferenceEndpoint
  -> 持久化注册 intent
  -> 投影 User ModelConfig
  -> Model Catalog 原子保存 endpoint、credential 与 model
  -> 提交 Provider 与模型归属
```

## 边界

- 启动时的本地 intent 恢复与 bundled 元数据刷新在 ready 前完成；远端模型查询由本 owner 的
  `ProviderModelSynchronizationLifecycle` 在路由完成后后台刷新。BackendRuntimeOwner 持有它的 start/stop，
  同一 connection 的并发同步共用一个执行，不建立第二条模型写入主链。
- 登出或替换授权凭据前取消并等待旧同步；关闭 Backend 时先取消同步，再在释放服务前等待收口。
  取消会中断目录 HTTP 请求，并在逐模型提交边界检查；已经开始的单条 durable 事务必须完成，不能中途丢弃。
- 同步结束后通过 Renderer integration 的窄通知重读模型目录，失败但已有部分提交时同样通知；日志只包含
  connection、耗时、取消状态和稳定错误类型，不记录上游响应或凭据。
- Provider Catalog 不知道凭据、route 或 AI SDK package。
- Runtime binding 不向 Renderer 暴露，也不能替代 inference factory registry。
- Model Catalog 只校验和保存最终 typed route，不识别 Provider 产品。
- Provider Configuration 只保存正式 Provider 与 ModelConfig 的稳定归属，不保存 endpoint 或 secret。
- 自定义 API 是另一条 command，不创建 ProviderDefinition，也不能伪装成本 use case 的 Provider。
- Use Case 不记录 API Key、URL 或 Provider error body；注册失败只返回稳定错误 code。
- OAuth access/refresh token 不进入本 use case；它只把稳定 account ID 写入 endpoint credential reference。

## 凭据复用语义

每个正式 Provider connection 当前只有一个 ConfiguredProvider 和一个 credential boundary。首次配置 API-Key
Provider 必须提交 API Key；账号型 Provider 必须先完成登录。同一 Provider 可以按模型绑定多个已验收
runtime route，因此可以拥有多个 InferenceEndpoint，但这些 endpoint 必须引用同一份 credential；同一路由
的模型继续复用 endpoint。`ModelConfig` 是 endpoint 引用的唯一 owner，Provider Configuration 只保存模型
归属。同一 `provider_model_id` 只能关联一个 ModelConfig，重复添加会明确返回
`model_already_registered`，不由 Renderer 或各 Provider 分别去重。已连接 Provider 的后续模型选择属于模型管理；添加页保留连接入口并导航到管理，不再次提交注册。
Custom API 没有 ConfiguredProvider 身份，即使 URL 相同也不会被误认成正式 Provider。

账号型 Provider 当前在授权后物化该账号从上游动态发现的可见模型，使 ConfiguredProvider 与模型管理立即可见；
Renderer 不再要求用户逐模型添加。批量同步逐项提交，并按 route 复用 endpoint、按 Provider 复用
credential，重复执行只跳过已经关联的目录模型；若某一项只写入 Model Catalog、尚未提交 Provider
归属，则停止后续同步并交给启动恢复，避免同一账号产生重复 route。已关联模型不会因为“存在”而跳过元数据：上游窗口、图片能力或展示名变化时必须更新原 ModelConfig，历史静态容量不能继续残留。账号目录是当前授权身份的模型集合真相；上游不再返回的旧静态模型复用 Configured Model Removal 的 intent、endpoint 引用计数和偏好清理流程退出，不能在同步器里复制删除顺序。

OpenCode Go 是首个多 route API-Key 产品：用户只粘贴一次 Key，首次启用最多三个近期模型（稳定版优先）；Kimi 等完整公开目录继续显示在模型管理中。Host 私有
binding 将模型显式分配给 OpenAI-compatible Chat、OpenAI Responses 或 Anthropic Messages。Renderer
不展示协议选项，也不按模型名或 URL 猜测协议。

Provider Configuration 与 Model Catalog 分文件持久化，因此 use case 使用 durable intent 协调写入。
进程在中间退出后，启动恢复只按 `model_config_id` 与 `inference_endpoint_id` 收口，不靠 URL 或名称猜测。
