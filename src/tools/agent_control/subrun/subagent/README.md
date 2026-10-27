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
- `subagent_type` 的可选值来自当前启用插件；共享 schema 只校验 description、prompt 和可选 subagent_type，不复制动态 registry。省略类型时使用 general，显式未知类型拒绝，不能静默改成另一种任务。
- child 默认不继承父会话历史；`inheritTurns` 只控制历史消息，不控制环境上下文。
- 默认通用 child 自动继承父 run admission 时冻结的 `project-context`、当前文档和插件 `current-view` Fence，包括项目文件清单；不自动继承 selection、user quote、附件或泛化 `additional-context`。
- child ToolContext 同时继承父运行已接纳的项目操作能力与 Workspace 身份，因此可以使用同一组文件工具；初始文件清单只是当前轮快照，运行中需要最新状态时调用 `list_files`。
- 普通叶子不注册 `task_write/task_read`，具备该工具的协调角色使用自身 working history；Subagent runner 不读取或注入父 TaskState；`prompt` 是父 Agent 的委派指令，必须写明子任务目标、约束和预期输出，不需要重复抄写已经自动注入的项目背景。需要材料时在 prompt 中写明正式 Workspace 路径、材料用途和产物路径；通用工具不要求填写额外材料清单，也不替业务绑定版本或改写请求。
- 工具说明要求父 Agent 逐项传递适用的用户限制，包括允许/禁止的来源与操作。继承的全局 command permission 不等于本任务材料白名单；这项提示不宣称新增了运行时权限拦截。
- `SubagentTypeContribution.inheritTurns` 可以为确实依赖父上下文的角色声明固定继承量；默认仍为 `0`，该值不暴露成模型可修改参数。
- `maxSteps` 由 child Agent Definition 持有；通用 subagent 工具不复制或覆盖该产品策略。
- 普通叶子不拥有 `subagent`。注册协调角色可声明直接子类型范围；目录和执行均过滤，不允许借父身份递归扩权。
- `SubagentTypeContribution.allowedCallerAgentIds` 限定可见/可执行调用方，`allowedSubagentTypes` 限定 child 自身的直接委派，`inheritEnvironment=false` 关闭环境 Fence 继承。注册策略不增加模型参数。Agent config 也可限定直接类型，首次冻结取两者交集；恢复使用自身冻结范围。
- Host 将已解析的 description/prompt/type 作为 delegation 与原合并 query 一起保存，目标 owner 可接纳结构化任务，避免从 description 文本猜出表单。恢复不重新解析新默认值。

## 结果合同

`@app/schemas` 的 `SubagentResultSchema` 是 Host、Conversation 与 benchmark 的共同事实来源。结果只保留描述、类型、child 启动时锁定的 `model_id`、权威 `subrun_ids`、唯一终态、最终答案和正式产物。`model_id` 来自 ToolContext 的已接纳执行模型，不能由模型参数传入，也不能在 Renderer 用当前选择补猜。

正式 `artifacts` 的通用提取来源只有两类：

- `write_file` / `edit_file` 成功结果中的 Workspace VFS inode；
- ToolNode observation governance 在 `tool_output.metadata.observationTruncation.blobId` 发布的 ToolOutputStore durable blob ref。

不能从 observation 扫描路径，也不能把 SharedMemory、Evidence 或任意 Resource URI 当作协作产物。父 Agent 用 `read_file(inode=...)` 读取 Workspace 文档，用 `tool_output_read(blob_id=...)` 继续读取 ToolOutput blob。

## 任务交接

`prompt` 是父 Agent 明确交给 child 的任务指令，工具仅在前面附上 description，不额外注入业务材料、阶段规则或产物接纳回调。研究、写作等领域的分工由对应 Agent 系统提示与本次任务请求负责。

普通 Workspace 写入产生的文档继续由正式事件提取为 artifacts；业务不能通过通用工具伪造已校验产物。子任务成功仅表示本次运行完成，不表示研究结论已经核验。

Renderer 通过独立的 `SubagentPresentationArgsSchema` 回放曾带有 input_documents 的历史参数；此只读兼容不恢复 live 参数，不启动旧交接流程。历史实际 child 输入仍以其持久运行事实为准。

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
