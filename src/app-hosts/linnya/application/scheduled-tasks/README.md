# 定时任务

App Server 按本机时区解释时间表。预览与写入共用 Croner 11 的五段 cron 计算和未来两年最短间隔校验。Croner 只负责计算时间。一次性计划保留本地日期和钟点，历史与补跑高水位使用 epoch 毫秒。

`scheduled_tasks` 保存计划与操作来源，`scheduled_task_runs` 保存运行历史。自动计划同时使用 UTC 时刻和本地日期分钟去重，手动运行使用独立的 UTC 时刻。两张表由 SQLite schema provider 在当前库版本内建立。项目删除级联清理，对话删除后运行记录仍可读。任务删除后保留卡片所需的来源和名称。

共享请求与 DTO 使用 `@app/schemas/scheduled-tasks` 子路径。

## 执行

Desktop App Server 就绪后开始分钟检查，停机先停止接纳。重启时把失去 Flow 的运行记为中断，并重新评估自动队列。SQLite 先写入唯一计划记录，再条件更新抢占队列，成功的 owner 才发起 Flow。等待审批和等待用户回答不占名额。新运行总是生成自己的对话，初始化任务档位、保存原 Agent，再从 Conversation Control 所用的 detached Flow 入口接纳。运行描述符冻结无人值守变体、任务运行身份和计划时刻；模型校验失败时记失败，执行中也固定已选择的模型。

下次运行时间按当前本地时间和已消耗的计划时刻推算。时区变更或时钟回拨时重新建立检查基准。超过两分钟的正向间隔按唤醒处理。时钟早于 Desktop 构建时刻时，列表返回 `clock_anomaly`，自动触发和未读计时暂停。只有拿不到构建时刻的宿主（直接导入源码的测试）才退回“比定时任务库最近时刻早 24 小时以上”判定：库里的时间戳可能写于一段跑快了的时钟，Desktop 若拿它当下限，改回正确时间后会一直判成异常。时钟曾跑到未来时写下的未读起点和查看时刻，下一次检查压回当前时刻，14 天未看计时从现在算。手动运行仍可用，异常期间完成的未读结果以时钟恢复时刻开始计时。

开发态默认只开放手动运行。Desktop 由发行身份和 `LINNYA_SCHEDULED_TASKS=1` 确定定时器是否启用。App Server 从 bootstrap facts 获取这个值。设置随 App Server profile 保存，Renderer 应用启动后通过模型目录生命周期用 `settings-set` 同步 `default_model_config_id`，任务的模型为空时读取该设置。运行完成、首次等待审批、失败和自动暂停经 Desktop 通知端口发出，补跑多项时发一条合并提示。

## 接入

- Preload 公开 `electronAPI.scheduledTasks`。`onChanged` 是无 payload 的失效通知，时区、UTC 偏移或时钟异常状态变更时也发出。`onNotify` 接收 `ScheduledTaskNotification`。原审批因重启失效时，`awaiting_approval` 通知带 `interrupted: true`。系统通知点击还会传入 `open=true`，App 导航用现有 workspace navigation 打开对应对话并标记已读。没有对话的点击由任务界面接收。手动打开定时对话后调用 `markViewed`。
- `/api/v1/conversation/list` 在 SQL 分页前折叠定时对话；任务详情通过 `runs` 翻历史。删除任务后，对话作为普通对话继续保留。
- 全局档位收紧预览提供 `scheduled_task_count`，明确选择 `include_scheduled_tasks` 才一起调整。模型删除确认可读 `/api/v1/models/:id/removal-impact` 的 `scheduled_task_count`。
- [Agent Shell CLI](../core-cli/README.md) 只按来源对话所归项目操作。修改权限高于调用方时，CLI 拒绝，并指向任务界面。

命令审批继续由 Commands owner 接纳。用户允许后，App Server 在已有运行等到名额时才交付该回复；已批准的运行先于新入队任务恢复。拒绝直接交付。状态查询按正式运行 ID 读取，用户随后在同一对话继续提问也不改变该次定时结果。
