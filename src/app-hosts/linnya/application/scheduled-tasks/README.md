# 定时任务

App Server 按本机时区解释时间表。预览与写入共用 Croner 11 的五段 cron 计算和未来两年最短间隔校验。Croner 只负责计算时间。一次性计划保留本地日期和钟点，历史与补跑高水位使用 epoch 毫秒。

`scheduled_tasks` 保存计划与操作来源，`scheduled_task_runs` 保存按计划时刻去重的执行记录。两张表由 SQLite schema provider 在当前库版本内建立。项目删除级联清理，对话删除后运行记录仍可读。任务删除后保留卡片所需的来源和名称。

共享请求与 DTO 使用 `@app/schemas/scheduled-tasks` 子路径。
