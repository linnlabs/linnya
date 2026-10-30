# Changelog

## 0.1.0

- 接入正式 Linnkit 0.41.0 与 Zod 4 合同；peer 最低兼容系列改为 0.41，
  packed CJS/ESM 与 Provider 两轮工具闭环仍由独立产物验收。

- 将产品失败classifier从共享capability构造依赖移到单次invocation；Host逐次绑定规则，
  避免同一codec并发服务不同连接时串用产品错误语义。删除旧构造字段，不保留双入口；
  SDK仍不持有Host产品身份，trace诊断计数与零SDK重试保持不变。

- 修复响应不完整被误归为不可重试 schema 失败、HTTP200后读取失败误归为 HTTP 错误；
  SDK 校验失败中的已解码 error envelope 只恢复可识别的上游语义，真正不兼容仍停止。
  安全诊断区分 SDK 错误类别与响应数据状态，并在 yield 前记录 canonical 终态；
  使用真实 compatible/DeepSeek codec 与 Host caller 验证重试、取消和失败片段撤回，SDK 保持零重试。

- 升级 AI SDK Core 至 `7.0.140` 与正式 Provider packages，xAI 使用 5.x Responses；
  Google 保留自动长输出续传之前的版本，避免改变单 attempt 请求合同。
  DeepSeek 使用上游原生工具图片实现，删除本地 pnpm patch 与修改声明；协议验收接纳
  Anthropic/MiniMax 的显式 none、Responses 的 strict=false 和 Qwen reasoning 回放。

- 区分模型工具输入错误与真实流生命周期违规：坏 JSON / 非 object 参数按现有 Linnkit
  预算重试；未知 Host 工具且参数为合法 object 时保留调用交工具层 admission，并只消费配对
  SDK validation error，不扩权或追加请求。补齐真实 Ollama/OpenAI codec 验收。
  安全诊断保留有限 invariant 与触发分片类型，主动 abort 不再掩盖原始分类。

- 将 `@ai-sdk/deepseek` 升级到 `3.0.44`，验证 `deepseek-flash` 历史 reasoning 与空 tool delta
  回放；通过精确 pnpm patch 复用上游图片编码，修复 native tool.content 图片被字符串化的问题。
  补齐用户/工具图片、非法格式拒绝、两轮 usage 与 CJS/ESM packed 验收；Host placement 和
  Provider Catalog 仍独立准入，补丁来源、边界、发行条件与退出标准见本 package README。

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
- 将上游 `invalid_prompt` 映射为独立的不可重试
  `provider_invalid_prompt`，不再将其泛化为 `provider_http_400`；该错误不参与切模或 fallback。
