# LLM Input Materialization Host Adapter

本目录是 Linnya 将持久化图片引用转换为 Provider 可消费、已核验 bytes 的唯一 Host 边界。Linnkit 只拥有 vendor-neutral 的引用、admission
evidence 与 port；Workspace 只拥有资产真实性和读取；本模块负责把两者编排成一次 active
route 的最终输入。

## 目录职责

- `definitions/`：Host 图片处理 profile、route
  limits、estimator 与 materialization guard 合同。
- `functions/`：收集 durable 图片、判断未物化引用、Provider-independent
  token 估算纯函数。
- `orchestration/`：核对 admission
  evidence、route/profile、上下文预算和 Workspace 解析结果，再生成 resolved
  attachments。
- `registry/`：已验证 route
  capability 到冻结 profile 的唯一绑定。默认注册表只绑定生产 AI SDK
  route；原生 Ollama profile 仅供待删除旧 codec 的回归测试。
- `index.ts`：Host public contract；外部模块不得导入内部文件。

## 负责与不负责

本模块负责：

- 在读取 bytes 前校验图片数量、单图/总字节和上下文预算。
- 通过 Workspace resolver 重新核验 durable identity、hash、MIME 和尺寸。
- 保持 message/attachment 顺序与 user/tool placement。
- 在 Provider 调用前阻断仍携带 durable ref 的输入。
- 写入 metadata-only 的 materialization evidence，不记录 bytes、路径或正文。

本模块不负责：

- 选择 Agent 模型、retry、fallback 或工具执行。
- 读取 Workspace SQL、模型密钥或发送 Provider 请求。
- 定义 Linnkit RuntimeEvent、Provider body 或前端附件 DTO。
- 根据模型名、Provider 名或 URL 猜 profile。

## 依赖方向

固定方向为
`Linnkit preflight → LlmInputMaterializerPort → 本模块 → WorkspaceLlmImageResolverPort`。Model
Registry 只在默认 registry 中把 active model 投影为显式 inference
capability；profile 选择只读 capability ID。

旧 LLM codec 可以在物理删除前临时消费本模块的 public
profile，以保证只有一个 profile 真相源；本模块禁止反向依赖旧 codec、AdapterFactory、AIEngine 或旧 LLM
transport。

## 测试要求

- 覆盖 user/tool placement、顺序、100/101 图片边界、单图/总字节、fallback
  profile 重算和上下文预算。
- 覆盖 Workspace 缺失、越界、hash/MIME/尺寸不一致等稳定错误映射。
- 负向断言 Provider 输入不含 durable id、resource id、hash、路径等 Host 字段。
- 新 route 必须先有真实 converter 与受控请求测试，再加入默认 profile
  registry；禁止只添加常量或快照测试。
