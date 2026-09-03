# Linnkit LLM Runtime Kernel

`packages/linnkit/src/runtime-kernel/llm/` 是 vendor-neutral 的模型调用内核。它围绕
`CanonicalInferencePort` 组织输入预检、canonical request、事件消费、重试预算、模型切换建议与
Agent RuntimeEvent 投影，不包含任何 Provider SDK、HTTP codec、凭据或产品模型目录实现。

## 负责与不负责

本模块负责：

- 通过 `LlmCaller` 暴露流式、非流式和带重试的调用编排。
- 把已物化消息投影为 canonical request，并消费严格的 start/terminal 事件流。
- 校验 tool call 生命周期、ordered assistant replay parts、usage 与 continuation 的通用合同。
- 按 billing、重试预算、错误分类与宿主注入的窄 policy 决定是否进行下一次 Linnkit attempt。
- 通过 `ModelCatalogLike` 和 `ModelResolverLike` 查询最小模型能力并选择明确的备用模型。

本模块不负责：

- Provider endpoint、认证头、请求体、SSE、SDK registry 或错误 body 解析。
- AI SDK 类型、Provider continuation wire codec 或 raw usage 字段解释。
- 产品 Model Catalog、API key 持久化、Cloud 网关、工具执行或 UI 协议。
- 在一次 Host attempt 内重试、双发请求或在不同 Provider codec 之间 fallback。

Provider 能力由宿主实现 `CanonicalInferencePort`。Linnya 的正式实现位于
`src/app-hosts/linnya/adapters/inference/`；应用级 canonical failure code 到切模建议的映射位于
`src/app-hosts/linnya/adapters/model-routing-policy/`。Linnkit 不允许反向导入这些宿主目录。

## 目录结构

```text
runtime-kernel/llm/
├── canonical-inference/      # canonical request 与严格事件状态机
├── input-capabilities/       # 模型输入能力需求与兼容性判断
├── input-materialization/    # 调用宿主物化 port 的发送前预检
├── functions/                # reasoning、重试预算、错误事件等纯规则
├── policies/                 # vendor-neutral policy contract 与空默认实现
├── streaming/                # thought/text 的通用流式分段
├── caller.ts                 # 公共编排入口
├── request-builder.ts        # 依赖装配
├── streaming-adapter.ts      # canonical event 到 Agent event/result
├── retry-fallback*.ts        # attempt、切模与总预算编排
├── usage-telemetry.ts        # canonical usage 到内核结果/账本
└── modelCatalog.ts           # 最小模型目录协议
```

## 依赖方向

允许：Graph/应用编排调用 `LlmCaller`；`LlmCaller` 调用 Linnkit ports；宿主在 composition root 注入
port、catalog、materializer 和 policy。

禁止：Linnkit 导入 AI SDK 或 Linnya Host；Graph 读取 Provider event；Host capability 执行工具；
policy 读取 Provider body、改写请求或自行选择具体 fallback model。

## 关键不变量

1. 每个 Host attempt 只绑定一个明确 route/capability，并只产生一个 terminal event。
2. Cloud attempt 不允许客户端补发；总真实上游次数同时受单模型与全局预算约束。
3. continuation 必须带完整 producer route identity，并归属 ordered assistant part；内核只保序，不读取、合并或压缩 payload。
4. `confidence=actual` 的 usage 必须来自 Host canonical event 且具有 Provider provenance；缺失不能被 raw shape 猜测或估算值冒充。
5. 图片等资源必须先经过宿主物化与输入能力门禁，durable identity 不得发给 Provider。
6. 取消以 canonical aborted failure 收口，不能发布普通 Provider 错误事件。
7. retry/fallback 只在所有 attempt 已终止后发布一条 classified Agent error；LlmNode 将同一条已发布 Runtime failure fact 交给 Host lifecycle，Host settlement 只能消费它，不能再创建第二条 run-level error。
8. 已经产生 live thought/answer 的失败 attempt 若继续重试，必须先发 `stream_reset` 撤回该 attempt 的 UI 投影；LlmNode 同时清空在途 assembler，最终 durable Assistant turn 只能来自成功 attempt。Host 只决定 canonical failure 是否可重试，不得直接操作 reset 或持久化。
9. canonical `finish=length/content_filter` 只表示传输正常收口，不表示 Assistant turn 完整。LlmCaller 必须把它投影为不可重试错误；截断正文与工具调用不得进入 Graph 决策，也不得自动续写或擅自改大模型输出预算。

## 测试要求

优先覆盖完整业务流：输入物化 → canonical request → 多 part/tool stream → retry reset → durable replay →
重试/切模/Abort 终态。可重试 stream failure 必须覆盖 partial output 撤回、成功 attempt 隔离和最终错误唯一性。Provider wire conformance 属于宿主 inference capability 的测试，不应在
Linnkit 复制一套 SDK fixture。

修改本模块至少运行 runtime-kernel LLM/Graph 针对性测试、类型基线与 model inference boundary
guard；涉及宿主装配时还要运行 Host capability 集成测试和对应 Electron 生产 E2E。
