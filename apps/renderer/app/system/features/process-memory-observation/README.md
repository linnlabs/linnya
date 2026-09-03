# Process Memory Observation

该 feature 是 Linnya 开发态内存录制与分析界面。入口位于“设置 → 内存诊断”，只在 `import.meta.env.DEV` 注册。

## 边界

- 主进程 `src/features/system/process-memory` 只提供单次进程快照；本 feature 负责每秒录制、会话状态、时间线、摘要、手动标记和 JSON 报告。
- 录制状态属于 app system，不属于 Settings。设置弹窗关闭后定时采样继续运行，重新打开可以停止或导出。
- 样本只保存在当前 renderer 内存，不写数据库、不接 Task/Queue、不自动上传。应用退出即清空。
- Slides、Editor 等业务不依赖本 feature。第一版通过时间线和手动标记关联操作；只有真实测试证明需要自动阶段标记时，才评估通用观测 port。

## 指标解释

- `totalWorkingSetMB`：Electron 各进程 working set 合计，适合观察峰值趋势，但共享内存可能被重复计入。
- `totalPrivateMB`：Electron 能提供时展示；macOS 上可能为空。
- `mainProcess.externalMB/arrayBuffersMB`：用于判断主进程中的 `Buffer`、ZIP、图片字节是否形成峰值。
- Renderer JS Heap：只代表主界面 V8 heap，Canvas、GPU 与隐藏 Worker 必须看进程 working set。
- 隐藏 Worker：主进程通过 `hiddenWorkerRuntime` 的 `workerId -> pid` 窄身份表标记，例如 `slides-raster`。

停止目标操作后不要立刻停止录制。Slides Raster Worker 当前有五分钟 idle 生命周期；需要继续观察回落曲线，区分正常延迟释放和长期持有。

## 开发控制台

界面之外，也可以使用同一会话：

```js
await window.__LINNYA_MEMORY_DIAGNOSTICS__.start()
window.__LINNYA_MEMORY_DIAGNOSTICS__.mark('start-operation')
await window.__LINNYA_MEMORY_DIAGNOSTICS__.sample('manual-checkpoint')
await window.__LINNYA_MEMORY_DIAGNOSTICS__.stop()
window.__LINNYA_MEMORY_DIAGNOSTICS__.getLatestSample()
window.__LINNYA_MEMORY_DIAGNOSTICS__.getReport()
```

`getLatestSample()` 供现有开发基准读取当前快照；`getReport()` 返回与界面导出相同的只读报告结构。两者都不暴露 Pinia store，避免控制台绕过 feature action 修改会话状态。
