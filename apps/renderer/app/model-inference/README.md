# Renderer 模型请求装配

本模块拥有编辑辅助等既有生成请求的跨能力装配：从 model-configuration 的公开合同读取用途绑定和推理设置，再通过 shared 的本地 Backend HTTP 客户端发送请求、消费流和调度回调。它不拥有模型配置状态、Provider SDK 或 Backend Agent loop。

公开入口是 `@app/model-inference`。现有请求字段、SSE 处理、回调及 AbortSignal 行为保持原样；本次只收回过去混在 shared/aiService 的产品默认值与生成流程。通用 HTTP/会话刷新和无模型选择规则的 Ollama 发现继续在 shared；model-configuration 的发现 adapter 不反向导入此生成入口。

旧 `/agent/invoke` 的 agentStreamService/agentEventProcessor 已没有任何生产调用方，本次删除，不为退役链路新增 App API。当前生成消费者只使用仍在使用的 generateText/generateTextStream 与用途默认值。
