# Canonical Mock Inference Capability

本目录是显式 `mock://` route 的唯一实现。它把受版本控制的脚本和严格 query 配置直接投影为
`CanonicalInferenceEvent`，用于开发环境、Host 集成测试与确定性 Agent 场景。

## 目录职责

- `definitions/`：脚本 catalog 与 preset 合同。
- `functions/`：catalog 校验、route 配置解析、文本分块和工具参数构造。
- `orchestration/`：按 canonical request 产生 start、reasoning/text/tool 与唯一终态。
- `mock-scripts.json`：受审查的内置脚本数据。
- `__tests__/`：文本与工具调用的完整 canonical 事件合同。

本模块不模拟 Provider HTTP、SSE 或 SDK 错误形状，不接受未知 preset/query，不从工具名猜 schema，
也不执行工具、重试、切模或保存历史。需要验证具体 Provider wire format 时，必须使用
`capabilities/ai-sdk` 的受控 HTTP fixture。

新增脚本必须先扩展定义和严格 parser，再增加从 route 到 terminal event 的集成测试；禁止恢复旧
OpenAI chat completion 兼容响应或在 catalog 外静默采用默认脚本。
