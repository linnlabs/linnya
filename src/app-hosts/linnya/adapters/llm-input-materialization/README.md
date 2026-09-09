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
  route；Ollama 原生 Chat 使用独立的 inline base64 profile。
- `index.ts`：Host public contract；外部模块不得导入内部文件。

## 负责与不负责

本模块负责：

- 在读取 bytes 前校验图片数量、单图/总字节和上下文预算。
- 产品入口把单条消息的图片聚合上限设为 100 MiB，具体 provider/transport profile 可以
  根据 wire 编码、厂商合同或请求体容量进一步收窄；当前 Anthropic Messages 仍保留更严格的
  20 MiB raw bytes profile。
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

## 图片上下文容量语义

- `CONVERSATION_IMAGE_MAX_TOTAL_BYTES` 是产品入口的单条消息 raw bytes 上限，当前为
  100 MiB；它只定义用户可提交的统一上界，不宣称每个 Provider 都能接受同样大的 wire
  request。
- route profile 另行定义单图、聚合图片数量和聚合 raw bytes 限制。Provider 的 base64
  膨胀、请求体上限或特殊媒体合同需要更严格门禁时，应在 profile 收窄，而不是让用户配置
  一组难以理解的底层参数。
- 当前流程已经是 byte-level JIT：历史消息只携带 durable image ref，materializer 在
  active route 的 admission 通过后才调用 Workspace resolver 读取并核验 bytes。一次请求
  会按顺序读取整批已接纳图片，再交给 Provider；这与“历史原始图片永远常驻上下文”不同，
  也不等同于把每张图片拆成独立 Provider 请求。
- 图片 token 预算与 raw bytes 上限独立生效。用户图片和 tool result 图片共享同一条 active
  route 的聚合门禁，因此连续读取多张 Slides 截图会累积到同一个总量。

## 测试要求

- 覆盖 user/tool placement、顺序、100/101 图片边界、100 MiB 聚合总字节、单图/总字节、fallback
  profile 重算和上下文预算。
- 覆盖 Workspace 缺失、越界、hash/MIME/尺寸不一致等稳定错误映射。
- 负向断言 Provider 输入不含 durable id、resource id、hash、路径等 Host 字段。
- 新 route 必须先有真实 converter 与受控请求测试，再加入默认 profile
  registry；禁止只添加常量或快照测试。
