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
- `subagent_type` 的可选值来自当前启用插件；共享 schema 只校验稳定字段，不能复制动态 registry。
- child 默认不继承父会话历史；`inheritTurns` 只控制历史消息，不控制环境上下文。
- 通用 child 自动继承父 run admission 时冻结的 `project-context`、当前文档和插件 `current-view` Fence，包括项目文件清单；不自动继承 selection、user quote、附件或泛化 `additional-context`。
- child ToolContext 同时继承父运行已接纳的项目操作能力与 Workspace 身份，因此可以使用同一组文件工具；初始文件清单只是当前轮快照，运行中需要最新状态时调用 `list_files`。
- child 不注册 `task_write/task_read`，Subagent runner 也不读取或注入父 TaskState；`prompt` 仍是父子之间唯一的任务语义交接合同，必须写明子任务目标、约束和预期输出，不需要重复抄写已经自动注入的项目背景。
- `SubagentTypeContribution.inheritTurns` 可以为确实依赖父上下文的角色声明固定继承量；默认仍为 `0`，该值不暴露成模型可修改参数。
- `maxSteps` 由 child Agent Definition 持有；通用 subagent 工具不复制或覆盖该产品策略。
- Deep Research beta 的内部阶段不注册为公开 `subagent_type`，Default、Slides 等普通父 Agent 无法看到或调用。
- 通用子 Agent 不拥有 `subagent` 工具，禁止递归扩权。

## 结果合同

`@app/schemas` 的 `SubagentResultSchema` 是 Host、Conversation 与 benchmark 的共同事实来源。结果只保留描述、类型、child 启动时锁定的 `model_id`、权威 `subrun_ids`、唯一终态、最终答案和正式产物。`model_id` 来自 ToolContext 的已接纳执行模型，不能由模型参数传入，也不能在 Renderer 用当前选择补猜。

正式 `artifacts` 只有两类：

- `write_file` / `edit_file` 成功结果中的 Workspace VFS inode；
- ToolNode observation governance 在 `tool_output.metadata.observationTruncation.blobId` 发布的 ToolOutputStore durable blob ref。

不能从 observation 扫描路径，也不能把 SharedMemory、Evidence 或任意 Resource URI 当作协作产物。父 Agent 用 `read_file(inode=...)` 读取 Workspace 文档，用 `tool_output_read(blob_id=...)` 继续读取 ToolOutput blob。

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
