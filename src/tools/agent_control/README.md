# Agent Control 工具族

`agent_control` 收口单个 Conversation 内 Agent 执行与协作相关的工具 facade。它是物理能力族，不是新的业务 domain、状态容器或统一运行时。

四个 feature 保持各自生命周期和事实源：

- `task/`：主 Agent 维护的 Conversation 长任务快照；事实来自 admitted working history 中配对成功的正式工具事件。
- `checkpoint/`：阶段摘要与模型上下文裁剪 marker；可选复用 TaskState domain 写入同一份任务快照。
- `ask/`：暂停当前 run 并等待用户填写问卷。
- `subrun/`：可见 Subagent、host-only batch 与公共 child-run admission/runner。

能力族 `index.ts` 只聚合工具类。feature 之间不能读取彼此内部状态；Checkpoint 对 TaskState 的协作复用 TaskState domain 和同一组参数合同，Subagent 不读取或注入父 TaskState。

产品口径见 [产品模型总览](../../../docs/product-model-overview.md)，TaskState 事实源见 [TaskState domain](../../domains/task-state/README.md)，child-run 宿主边界见 [Child Runs adapter](../../app-hosts/linnya/adapters/child-runs/README.md)。
