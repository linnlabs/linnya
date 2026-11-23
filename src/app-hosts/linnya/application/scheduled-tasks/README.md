# 定时任务

App Server 按本机时区解释时间表。预览与写入共用 Croner 11 的五段 cron 计算和未来两年最短间隔校验。Croner 只负责计算时间。一次性计划保留本地日期和钟点，历史与补跑高水位使用 epoch 毫秒。

`scheduled_tasks` 保存计划与操作来源，`scheduled_task_runs` 保存按计划时刻去重的执行记录。两张表由 SQLite schema provider 在当前库版本内建立。项目删除级联清理，对话删除后运行记录仍可读。任务删除后保留卡片所需的来源和名称。

共享请求与 DTO 使用 `@app/schemas/scheduled-tasks` 子路径。

## 执行

App Server 就绪后开始分钟检查，停机先停止接纳。定时检查、手动队列和结果收口使用同一份任务记录；并发名额从当前 Flow 运行与命令审批读取。等待审批和等待用户回答不占名额。新运行总是生成自己的对话，初始化任务档位、保存原 Agent，再从 Conversation Control 所用的 detached Flow 入口接纳。运行描述符冻结无人值守变体、任务运行身份和计划时刻；模型校验失败时记失败，执行中也固定已选择的模型。

开发态默认只开放手动运行。Desktop 由发行身份和 `LINNYA_SCHEDULED_TASKS=1` 确定定时器是否启用。App Server 从 bootstrap facts 获取这个值。设置随 App Server profile 保存，Renderer 用 `settings-set` 同步 `default_model_config_id`，任务的模型为空时读取该设置。运行完成、首次等待审批、失败和自动暂停经 Desktop 通知端口发出，补跑多项时发一条合并提示。

## 接入

- Preload 公开 `electronAPI.scheduledTasks`。`onChanged` 是无 payload 的失效通知；`onNotify` 接收 `ScheduledTaskNotification`，系统通知点击还会传入 `open=true`，界面用现有 workspace navigation 打开对话。手动打开定时对话后调用 `markViewed`。
- `/api/v1/conversation/list` 在 SQL 分页前折叠定时对话；任务详情通过 `runs` 翻历史。删除任务后，对话作为普通对话继续保留。
- 全局档位收紧预览提供 `scheduled_task_count`，明确选择 `include_scheduled_tasks` 才一起调整。模型删除确认可读 `/api/v1/models/:id/removal-impact` 的 `scheduled_task_count`。
- [Agent Shell CLI](../core-cli/README.md) 只按来源对话所归项目操作。修改权限高于调用方时，CLI 拒绝，并指向任务界面。
