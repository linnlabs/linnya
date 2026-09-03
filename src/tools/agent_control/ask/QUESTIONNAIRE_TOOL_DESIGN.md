# ask 交互工具

> **权威规范**：Conversation 工具与交互协议以
> [`docs/conversation-platform/09-tools.md`](../../../../docs/conversation-platform/09-tools.md)
> 和 [`src/tools/README.md`](../../README.md) 为准。本页只记录 `ask` 的业务边界。

## 业务能力

`ask` 让 Agent 用单选、多选或文本题收集用户输入，并暂停当前 run，直到用户提交或跳过。

live 工具输入由本 feature 的 `definitions/askToolInput.ts` 拥有；正式问卷结果、提交答案和历史回放兼容合同由 `packages/schemas/src/tools/ask.ts` 拥有。工具返回前校验正式 result；Renderer 使用共享合同完成 live/reload presentation admission。

## 单消息交互协议

1. `tool_call.arguments` 提供执行前预览；流式工具名占位只允许严格空对象。
2. 工具执行结果提供正式 `questionnaireId` 和题目事实，并通过 control 声明等待用户。
3. `requires_user_interaction.form.data` 是等待态问卷的 canonical 业务事实；事件只把既有工具实体修订为 active，不新建第二条问卷消息。
4. 用户提交或跳过时，Renderer 调用统一的 `concludeAskQuestionsInteraction` 编排。
5. Host 用唯一一条 incoming `tool_output` 保存 terminal interaction；submitted response 必须通过问卷答案 schema。
6. reload 从同一工具 row 恢复问卷与已提交答案，不依赖临时 UI 状态。

## Renderer 边界

`QuestionnaireCard.vue` 只消费 presentation。projector 同时判别参数、正式结果、`tool_call_id` 与 interaction；composable 只负责本地表单校验和提交动作。

等待用户时，工具顶层生命周期仍为 `loading/update`。Renderer 必须根据 active interaction 严格接纳 canonical form data，不能为了让卡片可提交而伪造 `tool_output(success)`。

live ask 使用 `single | multi | text` 判别联合：`single` 只接受选项字段，`multi` 才能声明 2 到 7 的 `maxSelect`，`text` 不接受选项字段。模型 JSON Schema 直接声明在 `AskTool`，执行 admission 与推导类型放在 feature 的 `definitions/`，两者共享边界常量并由注册链路测试校验；用于历史回放的共享 schema 不随 live 合同收紧。用户达到多选上限后，界面保留已有选择并提示上限，不能静默替换先前答案。

禁止在卡片或 composable 中读取 raw `args/result`、探测整包 message metadata、从非法 payload 构造空问卷，或另发用户消息模拟恢复执行。
