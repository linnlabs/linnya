# Markdown 流式解析与编辑器投影

## 1. 文档定位

本文档记录 Linnya 当前的 AI Markdown 流式链路，用于维护 SSE 消费、WASM 解析和 Tiptap 插入行为。

历史版本曾把早期 Python AI Service、FastAPI 与若干概念文件当成现行架构。这些实现已不存在；当前合同以 Linnkit runtime event、App Host `SsePort`、Renderer stream client 与 `parser-wasm` 为准。

## 2. 当前数据流

```text
Agent runtime
  -> EventBus / EventEnvelope<RoutedRuntimeEvent>
  -> App Host SsePort
  -> SSE markdown_chunk + stream_control
  -> Renderer agentStreamService
  -> useStreamingHandlers
  -> parser-wasm StreamingParser
  -> queueProcessor
  -> Tiptap / ProseMirror transaction
```

各层职责如下：

| 边界 | 权威实现 | 职责 |
| --- | --- | --- |
| Runtime 事件 | [`packages/linnkit/src/runtime-kernel`](../../../packages/linnkit/src/runtime-kernel) | 产生有 execution / conversation / turn 身份的事件 |
| Realtime 投影 | [`sse.port.ts`](../../../src/app-hosts/linnya/adapters/realtime/sse.port.ts) | 按 governance 将 runtime event 投影为 SSE，不解析 Markdown |
| SSE 合同 | [`sse.ts`](../../../packages/linnkit/src/contracts/sse.ts) | 定义 `markdown_chunk`、`stream_control`等事件及其身份字段 |
| Renderer 传输 | [`agentStreamService.js`](../shared/services/aiService/agentStreamService.js) | 解析 SSE frame，按事件类型分发回调 |
| 流式会话编排 | [`useStreamingHandlers.ts`](../domains/editor/services/useStreamingHandlers.ts) | 初始化、投递、finalize 解析器，并把 block event 交给编辑器 |
| Markdown 解析 | [`markdownService.js`](../shared/services/markdownService.js) 与 [`parser-wasm`](../../../packages/parser-wasm) | 按顺序缓冲 chunk，产生 `BlockEvent[]` |
| 编辑器投影 | [`queueProcessor.js`](../domains/editor/extensions/clipboard/markdown/streaming/queueProcessor.js) | 将 `BlockEvent` 投影为 ProseMirror 节点并提交事务 |

## 3. 跨层合同

### 3.1 Backend 只投影原始文本事件

`SsePort` 是 runtime event 到当前 Desktop Host SSE 的 adapter。它保留 execution 顺序和 render hint，但不识别 Markdown 区块，也不创建 ProseMirror 节点。

AI 最终文本的增量内容以 `markdown_chunk` 事件发送。事件合同中的 `text` 是未经区块投影的 Markdown 片段；Renderer 不应从 transport 分包边界推断段落、代码块或公式边界。

### 3.2 WASM 解析器拥有 Markdown 区块语义

`StreamingParser` 在一次生成会话内保持缓冲状态，将任意大小的文本 chunk 组装成 `BlockEvent`。现行块类型由 [`model.rs`](../../../packages/parser-wasm/src/model.rs) 定义，包括：

- `BaseBlock`
- `HeadingBlock`
- `CodeBlock`
- `QuoteBlock`
- `ListItemBlock`
- `HorizontalRuleBlock`
- `LatexBlock`
- `TableBlock`

`structured_content` 承载行内文本、mark 和行内扩展节点；`raw_content_fallback` 承载代码、公式或无法结构化时的原始内容。表格等块级结构通过 `attrs` 携带。

### 3.3 同一解析器实例必须串行调用

`markdownService.js` 用 Promise 链串行化 `process_chunk()` 和 `finalize_parsing()`。这是正确性合同，不是可选优化：

- 不同 chunk 不得并发进入同一实例。
- finalize 必须在已投递的 chunk 之后执行。
- finalize 开始后，全局 active parser 引用必须清空，新 chunk 不得落到旧会话。
- 完整 Markdown 一次性解析要创建独立 parser，不得复用 AI 流式会话的 active parser。

### 3.4 编辑器层只消费 `BlockEvent`

`queueProcessor` 根据 `block_type`、`structured_content`、`raw_content_fallback` 和结构化 `attrs` 构建编辑器节点。它还拥有首块插入位置、空 BaseBlock 填充、流结束状态和异常关闭投影。

不应把这些编辑器语义上移到 App Host，也不应让 SSE client 直接操作 ProseMirror transaction。

## 4. 会话生命周期

1. 开始生成前，`initializeNewStreamingParser()` 创建新实例并重置串行队列。
2. Renderer 每收到一个 `markdown_chunk`，就把 `text` 交给 `processChunkWithStreamingParser()`。
3. 解析器只在识别出完整块时返回 `BlockEvent[]`；空数组是正常中间状态。
4. `useStreamingHandlers` 取得最新编辑器插件状态，再将事件交给 `processQueue()`。
5. 成功结束、显式错误或连接异常关闭都要 finalize 剩余缓冲，然后以对应原因结算 StreamingMarkdown 插件状态。

Transport 的结束事件和 Fetch body 关闭都可能触发收尾。调用方必须保持收尾幂等，避免重复 finalize 或重复更新编辑器终态。

## 5. 响应性约束

流式显示是用户感知 Agent 正在工作的热路径，但不得用高频小事务换取“更流式”的表象。

- App Host 不解析 Markdown，避免把文本 CPU 工作放进 Desktop Main 事件循环。
- Renderer 保持 chunk 顺序，但不应根据网络分包数量无界增加 ProseMirror transaction。
- 对超高频输入做批处理时，必须保持首块插入、顺序、取消、错误和最终光标语义。
- 性能验证要同时观察 chunk 到达延迟、WASM 解析耗时、transaction 数量、Renderer long task 和 input-to-paint，不能只看总生成时间。

## 6. 修改门禁

修改该链路时至少要验证：

- Linnkit runtime event 到 SSE 的 contract test。
- `agentStreamService` 的 frame 拆分、事件分发和结束幂等。
- `useStreamingHandlers` 的成功、错误、异常关闭收尾。
- `parser-wasm` 的 chunk 边界、代码块、LaTeX、列表和表格用例。
- `queueProcessor` 的首块位置、连续块顺序、finalize 和异常状态。
- 真实编辑器中的输入、选择、滚动、光标和撤销行为零回归。

若修改 SSE 事件名、`BlockEvent` 字段或 ProseMirror 映射，必须同步修改共享合同、Rust 模型、Renderer 类型声明和上述测试，禁止在消费端增加无语义 fallback 掩盖合同不一致。
