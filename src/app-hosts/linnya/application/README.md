# Linnya Application Layer

`application/` 保存 Linnya App Host 的应用用例：当一个能力需要协调多个 domain、runtime owner 或持久化边界时，由这里通过窄 public contract 与 port 组织执行顺序。具体业务规则仍归属对应 domain 或 feature，外部协议、数据库和 Electron 细节仍归属 adapter。

每个一级目录是一项独立能力。目录内部继续按职责使用 `definitions/`、`functions/`、`orchestration/`、`registry/` 和 feature-local `shared/`；`orchestration/` 只负责步骤和分支，不承载计算规则。

## 命名边界

- 对外可调用的一项应用能力命名为 `*UseCase`，组合多个用例的宿主生命周期对象可命名为 `*ApplicationScope`、`*Runtime` 或 `*Lifecycle`。
- `Workflow` / `workflow` 保留给未来可注册、可配置、可执行的工作流产品，不能再用于普通应用层函数、接口、变量或目录。
- `orchestration/` 是代码职责名称，不是产品概念，可以继续用于放置多步骤应用编排。

新增能力前应先确认单一 domain 能否拥有它。只有真正跨边界的应用用例才进入本目录，禁止把这里演变成通用业务逻辑或 adapter 杂物间。

## 跨 owner 生命周期

- `conversation-runtime/`：在 Conversation routes 开放前，按固定顺序提交 Commands 与 Profiled Code Sandbox 两个生产 owner；它不依赖 Electron 或具体进程载体。
