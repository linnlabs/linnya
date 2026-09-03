# Ollama Onboarding Use Case

本 use case 拥有“从 Provider
Catalog 中的 Ollama 本地运行时创建可调用模型”的跨 domain 流程。Renderer 只提交
`provider_definition_id`、服务根地址、已发现的模型 ID、展示名和容量；Host 固定构造 OpenAI-compatible
Chat route、无认证 InferenceEndpoint 和 ConfiguredProvider 归属。

同一个 Ollama
ConfiguredProvider 当前绑定一个服务地址，后续模型复用同一 endpoint。不能在已有模型仍引用旧地址时静默切换服务；未来若支持多个 Ollama 实例，需要先定义多账号/实例选择产品语义，不能恢复 URL 分组或在 ModelConfig 增加
`provider` 字段。

注册与正式 Provider 使用相同 durable intent：先保存归属意图，再由 Model
Catalog 原子保存 endpoint 与 model，最后提交 ConfiguredProviderModel。Custom
API、AI SDK、Agent loop 和 Renderer store 不属于这里。
