# Task Batch

## 1. 模块定位

`subrun_batch` 是系统发起批量工作的正式父工具。它接收调用方已经拆好的任务清单，通过注册表中的同一个 worker Agent 受控并发启动多个 child runs，再把逐项事实聚合成一个标准工具结果。

该工具只注册到 host ToolRegistry，不进入任何 AgentDefinition 的 `availableTools`。因此它可以被 host forced-tool run 确定性调用，但不会增加模型可见工具数量，也不能被模型主动选择。

## 2. 目录职责

- `SubrunBatchTool.ts`：系统工具合同与 child-run 编排。
- `functions/buildSubrunBatchResult.ts`：无副作用的确定性结果聚合。
- `definitions/subrunBatchAggregation.ts`：聚合器消费的最小 child 结果类型。
- `__tests__/`：工具编排、注册边界和聚合业务合同。

跨前后端输入与结果 DTO 位于 `packages/schemas/src/tools/subrun-batch.ts`；renderer 的正式展示位于 conversation 域 `features/subrun-collection/`。本模块不复制这两层定义。

## 3. 输入合同

- `worker_prompt_key`：调用方显式指定的已注册 Agent prompt key。一批任务共用一个 worker；工具不猜业务类型。
- `subruns`：非空任务清单，每项包含稳定的 `unit_id`、`subrun_id`、用户可识别的 `description` 和自包含 `prompt`。
- 同一批中的 `unit_id` 与 `subrun_id` 必须分别唯一，结果顺序严格跟随输入顺序。

prompt key 使用字符串合同而不是内置枚举，因为插件也可以注册合法 Agent。未知 key 由 Agent registry 在 child run 启动边界报告为整体执行错误。

## 4. 执行策略

- 最大并发固定为 3，不暴露为系统输入参数，避免调用方绕过上游限流策略。
- child `maxSteps` 使用共享生产默认值 80，保持旧表格单行 Agent 的执行预算；不得套用简单 spike 的 12 步预算。
- `inheritTurns=0`，每个任务依靠自包含 prompt 隔离执行。
- 每个 child 显式使用父 run 当前模型，避免 `user_primary` worker 在系统调用路径静默退回默认模型。
- trace metadata 至少携带 `runner_tool`、`subrun_index` 和 `unit_id`，供 renderer 将实时工具输出关联到稳定业务单元。

并发 child run 不等于并发写业务资源。真实表格写入由后续 renderer `TableFillWritePort` 按 session 串行执行；本工具不能持有 Editor、ProseMirror 节点或表格坐标。

## 5. 返回与错误语义

- 成功返回 JSON 字符串，形状为 `StructuredToolResult`。
- `data` 保存完整逐项状态、final answer 和权威 `subrun_ids`，供 UI、持久化与 reload 使用。
- `observation` 是提供给当前父 Agent 的有界摘要，不包含仅供内部路由的 `unit_id/subrun_id`；完整身份只保留在 `data`，超长治理继续交给 ToolNode。
- child 部分失败或取消属于批量业务结果，父工具仍成功，逐项状态分别为 `failed` 或 `cancelled`。
- 参数合同错误、未知 worker、运行时基础设施异常等导致整批无法执行时直接失败，由 ToolRegistry/ToolNode 产生错误工具输出。
- `AbortError` 不转换为普通失败，继续沿 run 取消链传播。
- 禁止返回 `control.terminateRun` 或 `control.finalAnswer`。工具完成后必须回到当前父 Agent，由 LLM 正常生成唯一 `final_answer`。父 Agent 由产品调用方选择；表格系统批次使用无工具的 `system_batch_summarizer`，通用 host-forced 机制不硬编码具体 Agent。

以上约束只属于父 `subrun_batch`。worker 的终局工具可以结束自己的 child；`table_ai_fill` 使用的 `write_to_table` 就必须在写入成功后终止 child，并把写入内容作为 child final answer 交给本工具聚合。

## 6. UI 与回放

renderer 按工具名 `subrun_batch` 显式注册 `SubrunBatchCollection`。父工具在 conversation 中只占一个 visual-row，内部只渲染多个轻量 `SubrunProgressCard`；完整 child 消息经正式 admission 后在 `ConversationHost` 就地详情中展示。多个 child 共享稳定 trace accumulator，并按 `subrunId` 隔离。

host forced-tool 必须在进入 `SubrunBatchTool.run()` 前实时发出携带完整 `args.subruns` 的父 `tool_call_decision`，使父卡尽早形成权威顺序与详情描述。child trace 的 `tool_call_decision` 保存 canonical `tool_calls[]`，但不创建 queued/pending 可见步骤；各工具只在 `tool_process(start)` 后出现 loading，`tool_output` 再收敛 terminal 状态。不得为 batch 新增私有流协议或 queue UI。

reload 只重建父工具结果和 child trace，不重放任何业务写入副作用。实时写入只能消费当前 live stream 中的 child `tool_output` trace。

## 7. 当前边界

P3.3-P3.5 已完成正式系统工具、host 注册、模型不可见边界、renderer 展示和 Table 垂直接线。生产表格填充现在由 app workflow forced 调用本工具；本工具仍不拥有 Editor、写入 session 或 Conversation 状态。旧逐行 Flow 只保留到 P3.6 真机放行，随后在 P4 删除。
