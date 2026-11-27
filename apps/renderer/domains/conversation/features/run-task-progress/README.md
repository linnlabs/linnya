# Run Task Progress

运行中输入框上方的任务进度托盘：Agent 在本次运行里写过任务计划（`task_write`）时，显示一行“阶段 · 下一步”，
点开看目标、计划与后续步骤。样式与待发送插话托盘一致，两者同时出现时任务托盘在上。

## 规则

- 只在当前会话的交互运行未结束时显示（含等回答、已暂停）；运行结束即消失，卡片里的任务计划仍可查看。
- 数据取本次运行（`run_id` 相同）最新一条成功的 `task_write` 结果，不改 TaskState 合同，也不新建 store。
- 很长的运行里，本次运行的 `task_write` 可能不在已加载的消息窗口内；此时不显示托盘，不为它额外加载历史。
- 阶段名与工具卡共用 `definitions/taskStatePhaseMessages.ts` 的本地化文案。

## 结构

- `functions/selectRunTaskProgress.ts`：查找与解析（结果在 admission 时已校验，这里按合同读出）。
- `composables/useRunTaskProgress.ts`：接线，消息不变时不重新解析。
- `ui/RunTaskProgressTray.vue`：展示与展开，由 `AiAssistantInput.vue` 挂载。

## 验证

`__tests__/RunTaskProgressTray.integration.test.ts` 覆盖运行中显示最新计划、点开详情、运行结束后消失，以及没有（或未加载到）本次运行计划时不显示。
