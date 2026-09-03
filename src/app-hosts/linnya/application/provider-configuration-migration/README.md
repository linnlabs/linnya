# Provider Configuration Migration

这是开发期一次性数据迁移 use case，把旧正式 Provider/Ollama onboarding 已经写入 Model Catalog、但尚未
拥有 `ConfiguredProvider` 归属的模型补成稳定身份。它在 Model Catalog 与 Provider Configuration
初始化后、HTTP 路由开放前运行。

## 认领规则

迁移必须同时证明 ProviderDefinition 模型身份、runtime binding、endpoint ID 前缀、route profile、
API surface、capability、base URL、auth profile 与 endpoint model ID。仅 URL、模型名或协议相同不能
证明正式 Provider 归属，因此 Custom API 不会被认领。

Ollama 只认领旧入口曾生成的精确身份：`endpoint_id=ollama`、`openai_compatible_chat`、
`ai-sdk:openai-compatible`、无认证、不支持两类图片输入且不回放工具结果。迁移后它归属
Provider Catalog 中的 `local_runtime` Ollama，不按 URL 猜测，也不归入 Custom API。

同一 Provider 若出现多个旧 endpoint，或同一目录模型重复出现，迁移保留全部 Model Catalog 数据但
跳过该 Provider，不做猜测。迁移完成标记与新归属在一次 Provider Configuration 写入中提交；以后启动
不会长期双读旧结构。
