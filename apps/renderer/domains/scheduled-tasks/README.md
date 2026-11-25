# 定时任务（Renderer）

到点由 App Server 新建一个对话去做。时间表计算、名额、补跑、自动暂停、通知时机都归 App Server；
Renderer 只读写合同 `@app/schemas/scheduled-tasks`，结果一律按合同解析，不自己推算下次运行时间。

- `adapters/scheduledTasksClient`：经 preload（`window.electronAPI.scheduledTasks`）调用各 channel，返回前按 schema 解析。
- `store`：最近一次读取的任务列表、并发设置、运行中数量与“定时器是否打开”。侧栏角标、整页视图、对话列表折叠行共读这一份。
- `orchestration`：
  - `startScheduledTasksAppLifecycle` 在 App 启动时订阅变化推送并读一次全量；Main 在窗口位于前台时转来的通知，交给调用方显示为应用内提示。
  - `refreshScheduledTasks` 合并连续的推送：正在读时再收到只在读完后补读一次，不并发。
- `functions`：纯函数。时间表一句话描述、将来时刻写法（今天 / 明天 / 带星期的日期）、表单草稿、状态与运行记录的呈现、应用内提示文案。与某个预设完全等价的 cron（Agent 常用 `--cron` 建任务）由 `presetFromCron` 认出，按预设显示和编辑，保存后存成预设；认不出的保持“自定义”。
- `ui`：整页视图 `ScheduledTasksView` 在列表和单个任务的详情之间切换，新建与编辑是弹窗 `ScheduledTaskEditorDialog`；
  另有运行记录、删除确认和“更多”菜单。开关、立即运行、删除共用 `useScheduledTaskActions`。

## 交互约定

- 列表页头与知识库、插件市场共用 `PageSectionHeader`。列表一直挂着，从详情返回时滚动位置不变。
- 布局场景的 `visit` 每进来一次就变：停在详情时再点侧栏回到列表，再点同一个任务的通知重新打开它。
- 列表行默认写下次运行时间，指到或聚焦时换成开关和“更多”；状态要用户处理时，在原位写明原因。
- 编辑表单随改随调 `previewSchedule`，显示下一次运行或错误原因；保存前再按当前草稿查一次。
- 表单里的月历标出会运行的日子，由同一次 `previewSchedule` 的 `run_days_in` 返回，翻月时重查。“仅一次”直接在月历上选日子。
- 弹窗点空白处不关闭，避免丢掉没保存的内容。Esc 先关打开着的下拉、日期或时间面板，再关弹窗。
- 保存后按应用内提示告知，新建后进入该任务的详情。
- 新任务的命令权限默认与全局一致但最高到“标准”；选“完全访问”沿用设置页的确认框，并在风险提示后追加定时任务专用警告。
- 修改带 `expected_revision`；冲突时重读列表并按新版本重开表单。
- 删除只在界面上做。任务正在运行时可勾选“同时停止正在运行的这次”，默认不停。已产生的对话保留。
- 开发环境默认不开定时器（`LINNYA_SCHEDULED_TASKS=1` 才开），视图顶部提示，仍可“立即运行”手动试。
