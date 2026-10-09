# Subagent 工具与可见 Child Runner

本目录拥有 Linnya 的通用子 Agent 协作 facade；所有工具层可见 child run 共用的 runner 位于相邻的 `../shared/`，避免系统 batch 反向依赖本 feature 的内部实现。

## 稳定边界

调用链：

```text
subagent Tool
  -> 启用插件的 subagent_type registry
  -> subrun/shared.runRegisteredSubagent
  -> registered child-run invoker
  -> Linnkit generic child runtime
  -> subrun_trace + SubagentResult
```

- live ToolRegistry 只注册 `subagent`，不注册 `delegate` alias。
- 旧 `delegate` 只允许由 Renderer 历史配置展示，不进入 backend executable registry。
- `subagent_type` 的可选值来自当前启用插件，并按类型的 `allowedCallerAgentIds` 与父 Agent 的 `config.availableSubagentTypes` 交集过滤描述、JSON Schema 与实际执行；共享 schema 只校验稳定字段，不能复制动态 registry。两份名单均以未声明表示不额外限制、空数组表示禁用。空交集会省略本次模型目录中的 `subagent`，直接执行仍拒绝。可选目录不含 `general` 时模型必须显式选类型，不能默认另选一个角色。调用者身份与父侧范围来自 Host 首次接纳时冻结的请求，不接受模型参数、metadata 或父 child 的身份。
- child 默认不继承父会话历史；`inheritTurns` 只控制历史消息，不控制环境上下文。
- 通用 child 自动继承父 run admission 时冻结的 `project-context`、当前文档和插件 `current-view` Fence，包括项目文件清单；不自动继承 selection、user quote、附件或泛化 `additional-context`。
- child ToolContext 同时继承父运行已接纳的项目操作能力与 Workspace 身份，因此可以使用同一组文件工具；初始文件清单只是当前轮快照，运行中需要最新状态时调用 `list_files`。
- child 不注册 `task_write/task_read`，Subagent runner 也不读取或注入父 TaskState；`prompt` 是父 Agent 的委派指令，必须写明子任务目标、约束和预期输出，不需要重复抄写已经自动注入的项目背景。可选 `input_documents` 以非空、去重的正式 Workspace locator 列表显式绑定材料；省略时旧调用与历史参数继续有效。绑定不等于 child 已读取材料。
- 工具说明要求父 Agent 逐项传递适用的用户限制，包括允许/禁止的来源与操作。继承的全局 command permission 不等于本任务材料白名单；这项提示不宣称新增了运行时权限拦截。
- `SubagentTypeContribution.inheritTurns` 可以为确实依赖父上下文的角色声明固定继承量；默认仍为 `0`，该值不暴露成模型可修改参数。
- `maxSteps` 由 child Agent Definition 持有；通用 subagent 工具不复制或覆盖该产品策略。
- 只供特定父 Agent 使用的内部角色必须声明调用者名单，不能因为未出现在菜单就假定执行已隔离。
- 通用子 Agent 不拥有 `subagent` 工具，禁止递归扩权。

## 结果合同

`@app/schemas` 的 `SubagentResultSchema` 是 Host、Conversation 与 benchmark 的共同事实来源。结果只保留描述、类型、child 启动时锁定的 `model_id`、权威 `subrun_ids`、唯一终态、最终答案和正式产物。`model_id` 来自 ToolContext 的已接纳执行模型，不能由模型参数传入，也不能在 Renderer 用当前选择补猜。

正式 `artifacts` 的通用提取来源只有两类：

- `write_file` / `edit_file` 成功结果中的 Workspace VFS inode；
- ToolNode observation governance 在 `tool_output.metadata.observationTruncation.blobId` 发布的 ToolOutputStore durable blob ref。

不能从 observation 扫描路径，也不能把 SharedMemory、Evidence 或任意 Resource URI 当作协作产物。父 Agent 用 `read_file(inode=...)` 读取 Workspace 文档，用 `tool_output_read(blob_id=...)` 继续读取 ToolOutput blob。

## Host 任务交接扩展

Host 可向当前运行的 ToolContext 注入 `prepareSubagentTask`，接收已校验参数、已授权的类型（含 `promptKey` 与 `inheritTurns`）和已锁定模型，返回派生 context、实际 child 请求、可选稳定 subrun 身份与 `acceptResult`。公开类型见 `definitions/subagentTask.ts`。准备端口不能启动模型或另建 runtime；工具仍唯一调用通用 runner。无端口时沿用默认请求，并把显式材料列表附到 child 请求。

`acceptResult` 只在 child 成功且未取消后接纳业务产物；返回值与通用提取器结果合并去重，再经原有 `SubagentResultSchema` 校验，不扩张结果 shape，也不在通用提取器添加领域工具名。准备或接纳失败直接传播，不能把拒绝的产物伪报成功。运行恢复时 Host 必须重新安装端口，并复用原调用的冻结请求/身份；业务效果的原子性仍由实际文档 owner 负责。

Host 可能按角色补充材料版本与交付要求。因此父工具卡中的 `prompt` 是“父委派指令”，不是完整实际 child 请求；真实 child incoming fact 与 RunDescriptor 保存实际请求。不能声称卡片中的原始参数等于全部模型输入。当前 registered child 会清除父 `prepareSubagentTask` 并覆盖调用者身份，防止同伴或嵌套 worker 借用准备能力；其它已绑定业务能力仍由其 owner 校验实际 run 身份。

本工具每次执行一个 child。普通 ToolNode 顺序执行同一 decision 的多个 `subagent` 调用，不能据模型一次请求多个调用声称并行。现有 `subrun_batch` 是 Host 同 worker 批量协议，不代替异构角色委派；未来并行扩展须复用 shared runner 并定义统一批量合同。

## Runner 约束

`runRegisteredSubagent` / `runRegisteredSubagentsInParallel` 负责：

- 校验父工具锚点与 trace publisher；
- 统一组装 `parentToolCallId`、trace policy 与执行策略；
- 透传显式模型、取消信号和可选父历史策略；
- 保持 child 结果顺序与输入顺序一致。

业务工具不得复制 trace 映射或绕过 runner 启动一个不可见 child。并发 child 也不等于并发写入；多个 child 修改同一文档时，写入领域仍须提供自己的串行化或版本冲突合同。

## 目录职责

- `subagentTool.ts`：模型工具 facade、动态描述、canonical 结果组装。
- `../shared/subagentRunner.ts`：由 subagent、系统 batch 与产品工具共同复用的 child-run orchestration。
- `functions/resolveSubagentType.ts`：动态 registry 类型解析。
- `functions/extractSubagentArtifactRefs.ts`：按正式生产者提取交接产物。
- `functions/deriveSubagentStatus.ts`：稳定终态分类。
- `__tests__/`：工具合同与失败恢复验证；runner 编排测试跟随 shared feature。
