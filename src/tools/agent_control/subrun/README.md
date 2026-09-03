# Subrun 工具族

本目录收口 Linnya 工具层的 child-run 入口，但不实现 Linnkit child runtime：

- `subagent/` 是模型可调用的通用协作 facade，负责动态类型、结果与正式 artifact 投影。
- `batch/` 是 host-only 的确定性批量父工具，不进入任何 Agent 的模型可见工具清单。
- `shared/` 拥有两者和其他产品工具共同复用的父工具锚点、trace policy、并发与 registered child-run invoker admission。

`subagent` 和 `batch` 只能依赖 `shared/` 的公开入口，不能互相导入内部实现。业务资源写入、TaskState 和 Conversation UI 均不属于 shared runner；child 默认仅消费调用方给出的自包含 prompt。

具体合同见 [Subagent](./subagent/README.md)、[Batch](./batch/README.md) 和 [Conversation Subruns](../../../../docs/conversation-platform/10-subruns.md)。
