# Changelog

## 0.1.0

- 建立可选 Linnkit AI SDK adapter workspace
  package、生产出口、conformance 测试出口和独立构建边界。
- 迁入 canonical request、usage、continuation、failure 和 stream
  reliability 投影。
- 迁入 language stream orchestration、factory registry 与全部 Provider
  conformance，删除 Host 旧 language 执行路径。
- 具体 language
  Provider 依赖、版本与 factory 收口到 package，并按 Provider/capability 拆分独立模块。
- 增加 Host failure classifier 与脱敏 diagnostic
  sink 扩展点，不向通用 adapter 泄漏产品错误语义或日志实现。
- 增加真实 tarball CJS/ESM/DTS import 与两轮 canonical tool round-trip 门禁。
- 增加按 capability 或 npm
  package 选择受影响 conformance 的定向升级命令，并输出脱敏 suite/package 诊断。
- 将 `@ai-sdk/deepseek` 从 `3.0.28` 升级到
  `3.0.29`，接收上游对空字符串 tool-call
  ID 的修复，并以 DeepSeek 定向 conformance、全矩阵和真实 tarball
  smoke 完成首个单 Provider patch 升级演练。
- 将 AI SDK Core 与全部正式 Provider
  package 刷新到 2026-08-27 审核版本；新增官方 `@ai-sdk/zai@3.0.1`、独立
  `zai_chat` capability 和两轮 reasoning/tool/usage
  conformance，Z.AI 不再借用通用 compatible codec。
- 适配 AI SDK 7.0.83 的
  `StreamProviderError`，只按 type、code、status 等安全字段投影流中 Provider 故障，不传播 message 或原始 data，并保持既有 canonical
  failure code 稳定。
- 补齐
  `gpt-6-astra` 的 reasoning 能力准入、ChatGPT Codex reasoning 请求 conformance，
  并把 `response.failed` 的安全 `type/code/reason` 暴露给诊断日志，便于定位 Provider
  400 而不记录请求或响应正文。
- 补齐 MIT 许可证、Node 22
  engines、独立 manifest 和真实制品门禁；package 保持宿主 monorepo 内部、不可发布，Linnkit
  Quickstart 继续保持自包含。
