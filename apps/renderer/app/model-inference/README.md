# Renderer 模型请求装配

本模块拥有编辑辅助等既有生成请求的跨能力装配：从 model-configuration 的公开合同读取用途绑定和推理设置，再通过 shared 的本地 Backend HTTP 客户端发送请求、消费流和调度回调。它不拥有模型配置状态、Provider SDK 或 Backend Agent loop。

公开入口是 `@app/model-inference`。请求字段与回调名沿用原有合同；本模块收回了过去混在 shared/aiService 的产品默认值与生成流程。通用 HTTP/会话刷新和无模型选择规则的 Ollama 发现继续在 shared；model-configuration 的发现 adapter 不反向导入此生成入口。

旧 `/agent/invoke` 的 agentStreamService/agentEventProcessor 已没有任何生产调用方，本次删除，不为退役链路新增 App API。当前生成消费者只使用仍在使用的 generateText/generateTextStream 与用途默认值。

## 流的读取与成败

两个入口共用 `orchestration/readGenerationEventStream.ts` 读 `/conversation/next` 的 SSE：分帧用 Linnkit 的 `createServerSentEventFrameParser`，每个事件用 `validateSSEEvent` 校验，事件名与 payload 类型必须一致。成败只按整条流的收尾判断（`functions/resolveGenerationStreamFailure.ts`）：

- 收到 `error` / `transport_error`，或 `transport_end` 的原因不是 `complete`，都算失败；
- 流关闭时没有 `transport_end` 也算失败。运行尚未接纳就出错时 Router 只记日志、直接关流，这是客户端唯一能看到的信号。

失败时 `generateText` 抛出带后端错误信息的 `GenerationStreamError`，不返回空文字；`generateTextStream` 先回调 `onError` 再抛出，且不回调 `onStreamEnd`，与 HTTP 失败同一合同。用户取消统一抛 `AbortError`，不回调 `onError`。对话主链路有自己的投影读取（`domains/conversation/services/conversationService.ts`），本模块只服务标题、补全、翻译、写作、审阅等生成请求。
