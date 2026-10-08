# Provider 在线模型发现

本用例连接正式 Provider、已有凭据、官方目录 adapter 与设置页候选。刷新是一次远端查询，不是重读安装包目录。

- `adapters/provider-model-discovery`
  负责官方协议读取和资料准入，当前接入 DeepSeek 与 Ollama Cloud。
- 本用例只在完整成功后原子替换本进程候选。网络、鉴权、取消或解析失败保持上次成功结果，同时向调用方失败。
- 列表和 onboarding 使用同一候选。来源确认存在但缺少容量等必要资料的模型仍显示，说明原因并禁止启用。
- 候选是本进程缓存；退出后重新查询。已经启用的 ModelConfig、容量与用户偏好照常持久化，重启不会丢失。
- 只读取已配置 connection 的凭据；Renderer 仅传 configured provider
  ID，不得到 secret、URL 或调用协议。

App composition 用 `ProviderModelSynchronizationLifecycle`
合并同 connection 并发刷新、取消和退出收口，再调用 onboarding 刷新已激活模型。API-Key 目录不自动激活新模型，不删除旧配置，也不按别名替换历史模型 ID。支持在线发现的 connection 启动时不再用 bundled 资料覆盖已经保存的模型事实；其余供应商保留原发布目录行为。ChatGPT 使用原账号目录同步，不借用此 API-Key 发现流程。

官方目录决定当前模型集合；容量与能力来自明确的官方字段或精确 model
ID 的已准入元数据。远端资料不得改写本地已经验收的 runtime
binding、认证或 API 地址。

测试覆盖取得失败不污染候选、缺失凭据、取消、候选/激活共用身份以及已激活模型保持身份与偏好。
