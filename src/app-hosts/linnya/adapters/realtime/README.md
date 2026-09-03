# Linnya Realtime Adapter

Layer: `app-host`

本目录承载 Linnya 当前的 realtime adapter 默认实现。

当前职责：

- 订阅 `EventBus`
- 先用 linnkit `eventGovernance` 过滤 `RuntimeEvent`
- 调用 `contracts.runtimeEventToSSEEvent()` 做标准 `RuntimeEvent -> SSEEvent` 投影
- 在官方投影之后追加 Linnya 私有 meta（例如 `render_hint` / `stream_completed`）
- 作为后端唯一实时推送出口的默认实现

当前文件：

```text
src/app-hosts/linnya/adapters/realtime/
├── sse.port.ts
└── __tests__/
    └── sse.port.test.ts
```

边界说明：

- realtime lifecycle policy 仍由 独立 Linnkit 仓的 `src/runtime-kernel/events/eventGovernance.ts` 定义
- 标准 SSE 字段映射由 独立 Linnkit 仓的 `src/contracts/sse.ts::runtimeEventToSSEEvent` 定义
- 这里不定义新的 runtime 事实事件
- 这里只追加宿主表现层 meta，不把 `render_hint` 等 host 关切写回 runtime-kernel

当前状态：

- realtime 默认实现已经只保留本目录这一个真实 owner
- 旧 `core/execution/sse.port.ts` 已删除
- 旧 `AnyAgentEvent -> SSE` 投影已删除；graph/flow 仍保留 `AnyAgentEvent -> RuntimeEvent` 桥接

开发注意：

- 改 SSE wire 字段，先改 linnkit contracts mapper 和契约测试，再看 host 是否需要 meta enrichment。
- 改 `render_hint` / dev error log 这类 Linnya 私有行为，只改本目录，不要回写 linnkit contracts。
