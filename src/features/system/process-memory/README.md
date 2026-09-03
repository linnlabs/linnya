# Process Memory

该 feature 是 Linnya 桌面端进程内存事实的唯一 owner。它按请求即时读取 Electron 多进程 working set、主进程 V8/Buffer 内存与系统可用内存；不启动定时器、不保存历史、不落数据库，也不理解 Slides、Editor 等业务操作。

`app.getAppMetrics()` 只能返回 Chromium 进程类型。为了区分普通 renderer 与隐藏 Worker，主进程在采样时读取 `hiddenWorkerRuntime` 暴露的窄身份表 `workerId -> pid`。该表只用于诊断展示，不参与 Worker 调度与生命周期判断。

隐藏 Renderer Worker 的业务定义与调用 owner 位于 App Server，真实 `BrowserWindow` 与 `pid` 身份表只属于 Electron Main。两端通过 data-only reverse RPC 同步注册、调用与注销；内存诊断只读取 Main 的 Desktop host 身份表，不依赖跨 bundle `globalThis` 或复制 Backend registry。

Renderer 的录制会话、时间线、摘要与 JSON 报告归 `apps/renderer/app/system/features/process-memory-observation`。设置页关闭后录制仍继续，应用退出后样本自然消失；第一版不接 Task、Queue 或持久化遥测。

注意：`totalWorkingSetMB` 是 Electron 各进程 working set 的合计，可能包含共享页，不能当作操作系统精确私有内存；分析时应同时查看 `totalPrivateMB`、单进程变化和主进程 `externalMB/arrayBuffersMB`。
