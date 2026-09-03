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

API-Key 的 bundled Provider 不拥有动态账号目录，因此启动时使用
`refreshRegisteredBundledProviderModels` 仅原位刷新已经激活的 ModelConfig。它复用注册 builder 更新名称、容量、模型能力和
route placement，不自动激活新模型，也不删除已从公开目录退出的模型；新增和移除仍由模型管理的显式操作负责。

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
`model_already_registered`，不由 Renderer 或各 Provider 分别去重。已连接 Provider 的后续模型选择属于模型管理，不再次进入添加页。
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
