# 项目待办

`store/todoStore.ts` 持有列表、加载状态与同步 action；组件通过 Pinia selector 读取列表，通过 `runtime.ts` 的 `useTodoActions` 执行 IPC 与订阅流程。订阅按 Pinia 实例登记一次，收到当前项目变更后复用同一加载流程。

日期分组与排序由 `functions/projectTodoState.ts` 计算，数据库 JSON 和状态切换规则由 `functions/projectTodoRecord.ts` 投影。完成任务移到列表首位，撤销完成按原位置替换；截止日期按本地日历日期比较。状态类型由 `definitions/todo.ts` 持有。
