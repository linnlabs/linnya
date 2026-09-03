# Node Event Loop 响应性观测

本模块提供 Main、App Server 和 feature compute child 可复用的 Node event-loop 观测 primitive。它只采集 delay histogram 与 event-loop utilization，并把固定时间窗投影为结构化 sample；不拥有业务状态、不写数据库，也不决定某个操作是否成功。

## 边界

- `definitions/`：sample、阈值和生命周期 port。
- `functions/`：Node 纳秒/毫秒单位转换、空 histogram 归一化和门禁判断。
- `orchestration/`：`perf_hooks.monitorEventLoopDelay()`、ELU 差值和采样定时器生命周期。
- 调用方决定 component 名称、采样窗口、阈值和日志/测试 sink。本模块不建立全局 monitor manager。

## 使用规则

- monitor 必须由所在进程的 App owner 显式 `start()`，并在诊断日志关闭前 `stop()`。
- sample 只包含时间、延迟和利用率，不记录命令、源码、用户输入或工具结果。
- `thresholdExceeded` 是响应性门禁，不是 Runtime fact，不能驱动重试、取消或 UI 状态。
- 健康 sample 是否写日志由调用方控制；生产默认只报告超限，避免周期日志放大事件循环压力。

## 当前门禁与剩余量化证据

生产 Main 和 App Server 都以 5 秒窗口启动本模块：Main 的门禁是 p99 delay ≤ 25ms、单窗 maximum ≤ 100ms；App Server 的门禁是 p99 delay ≤ 50ms、单窗 maximum ≤ 200ms。阈值超过时写结构化诊断，健康采样默认不落盘。

Node event-loop sample 只能证明所在进程的调度状态，不能证明 Renderer 仍然丝滑。Agent 执行响应性的完整量化验收还必须在真实 Electron 中并发运行 Command 高输出/持续写盘、Slides build 和后台 Worker，同时测量 Renderer input-to-paint、long task、rAF gap，并持续执行输入、选择复制、滚动、切换会话、展开命令卡、审批、PTY、取消和窗口 resize。

当前 App Server cutover 与人工前端零回归验收已经通过，但上述 Renderer/组合压力量化 fixture 尚未形成稳定自动化门禁。它由 [`docs/conversation-platform/11-testing-gates.md`](../../../../docs/conversation-platform/11-testing-gates.md) 和 [`docs/audit/risk-register.md`](../../../../docs/audit/risk-register.md) 的 `F6-01` 继续跟踪；不能把“已异步”或单独一份 event-loop sample 当成完整响应性证明。
