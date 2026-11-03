# 用户会话撤销

本 feature 持有每个 Backend 实例内、按文档与视图隔离的用户撤销/重做栈及视图打开基线。`store` 仅接收同步状态，不读取数据库、不计算合并规则、不调用编排；连续编辑合并、容量裁剪及撤销后的逆记录选择由 `functions` 返回新状态。公开读取的栈为只读集合。

跨 feature 的提交、Agent 组及版本历史步骤由 `backend/orchestration/history` 装配。计算阶段只捕获候选历史，正式 SQLite 事务成功后才安装内存栈；回执重试不移动栈。Agent 写入不进入用户栈，用户发起的组撤回和版本恢复进入用户栈。视图关闭释放栈与编辑声明，长期历史和其他视图不受影响。

字段逆变更的共同规则位于 Backend 范围的 `shared/history`，供用户撤销与 Agent 撤回复用；本 feature 不反向导出顶层运行态，也不把 Agent 组持久化规则放进 store。

每个用户步骤带原正式请求编号 actionId。面向某次撤回的“重做”应调用 undo 并携带该撤回回执的 expectedActionId；Backend 在新请求事务构造计划时核对栈顶，不匹配报 canvas_history_head_changed。普通快捷键不传该约束。全跳过撤销仍消费用户步骤，因此内容 sequence 无法代替栈顶身份；已成功请求重试优先复用回执，不再次校验或移动栈。
