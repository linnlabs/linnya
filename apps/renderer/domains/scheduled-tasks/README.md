# 定时任务（Renderer）

到点由 App Server 新建一个对话去做。时间表计算、名额、补跑、自动暂停、通知时机都归 App Server；
Renderer 只读写合同 `@app/schemas/scheduled-tasks`，结果一律按合同解析，不自己推算下次运行时间。

- `adapters/scheduledTasksClient`：经 preload（`window.electronAPI.scheduledTasks`）调用各 channel，返回前按 schema 解析。
- `store`：最近一次读取的任务列表、并发设置、运行中数量与“定时器是否打开”。侧栏角标、整页视图、对话列表折叠行共读这一份。
- `orchestration`：
  - `startScheduledTasksAppLifecycle` 在 App 启动时订阅变化推送并读一次全量；Main 在窗口位于前台时转来的通知，交给调用方显示为应用内提示。
  - `refreshScheduledTasks` 合并连续的推送：正在读时再收到只在读完后补读一次，不并发。
- `functions`：纯函数。时间表一句话描述、将来时刻写法（今天 / 明天 / 带星期的日期）、表单草稿、状态与运行记录的呈现、应用内提示文案。
- `ui`：整页视图 `ScheduledTasksView`（左侧按项目分组的列表，右侧详情或编辑表单）、运行记录、删除确认。

## 交互约定

- 编辑表单随改随调 `previewSchedule`，显示接下来最多 3 次或错误原因；保存前再按当前草稿查一次。
- 新任务的命令权限默认与全局一致但最高到“标准”；选“完全访问”沿用设置页的确认框，并在风险提示后追加定时任务专用警告。
- 修改带 `expected_revision`；冲突时重读列表并按新版本重开表单。
- 删除只在界面上做。任务正在运行时可勾选“同时停止正在运行的这次”，默认不停。已产生的对话保留。
- 开发环境默认不开定时器（`LINNYA_SCHEDULED_TASKS=1` 才开），视图顶部提示，仍可“立即运行”手动试。
