# Topic · 资源监控 / 卡死处置 / 紧急消息穿透（CC / Codex / Hermes / OpenClaw 源码深度对比）

> 调研日期：2026-04-23
> 调研深度：**深**（4 个 explore subagent 并行直接读源码 + 关键 file:line 引用）
> 触发：linnsec `01b-product-scenarios.md` §5.4 拍板 —— 主人 §2 提出"内存不够 / agent 卡死，主人不在电脑旁，这个有点危险，需要谨慎评估"，合并 §5.1 残留的"紧急消息穿透勿扰期"
> 笔记类型：**主题横向**（4 家全调研——这是 4 家场景差异最大的题，结论恰好反向印证主人"危险"判断）
> 调研纪律：严格遵循上次教训（必须直接读源码 + file:line 引用 + subagent 派发指令明令禁止只读笔记/WebSearch）

---

## 0. 本次主题为什么必须横向调研

§5.4 实际包含**三个相关但独立的子问题**，主人 §2 + §5.1 残留合并：

1. **资源监控**（系统 CPU / 内存 / 磁盘 / 进程数）：主人不在电脑旁时如何感知"机器扛不住了"
2. **卡死 / 异常 agent 处置**：检测 + 决策（kill / 重启 / 让其继续）
3. **紧急消息穿透**：主人勿扰期内"老板真有急事"如何到达

4 家在这三块的设计差异极大，**且大部分关键功能 4 家全部不做** —— 这本身就是关键发现。

---

## 1. 调研提纲

5 条调研维度（针对 4 家分别走一遍）：

1. **系统/进程级资源监控**（CPU / 内存 / 磁盘 / 进程数 / `/health` 端点）
2. **Agent 卡死 / 超时 / 异常检测**（探活 vs inactivity-based）
3. **异常处置**（kill 策略 / 重启 / 用户审批）
4. **紧急消息穿透 / 通知分级**（quiet hours / DND / 多通道兜底）
5. **优雅降级**（资源压力下行为变更）

---

## 2. Claude Code (CC) 源码事实

**仓库**：`<upstream-workspace>/claude-code-main/`

### 2.1 资源监控

- **进程内存预警（仅 UI）**：`hooks/useMemoryUsage.ts:11-35` 每 10s 用 `process.memoryUsage().heapUsed` 与 1.5GB / 2.5GB 阈值比较，**仅 UI 提示，不触发任何 kill/降级**
- **遥测元数据**：`services/analytics/metadata.ts:648-674` `buildProcessMetrics()` 用 `process.memoryUsage()` + `process.cpuUsage()` 算 CPU%，**仅作分析事件元数据**，不是独立"资源管理器"
- **Token autocompact**：`services/compact/autoCompact.ts:62-90` `AUTOCOMPACT_BUFFER_TOKENS = 13_000` + `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000` + `ERROR_THRESHOLD_BUFFER_TOKENS = 20_000`
- **Bash 输出文件 size watchdog**：`utils/ShellCommand.ts:52-54` `SIZE_WATCHDOG_INTERVAL_MS = 5_000` 防背景任务写爆磁盘（直接 kill 进程）
- **未做**：在 `<upstream-workspace>/claude-code-main` 下 grep `os.cpus\(` / `os.freemem\(` / `freespace` / `statvfs` 均无匹配 —— **无主机级资源监控**
- **未做**：grep `oom` / `resourceMonitor` 无匹配；`healthsweep` 仅在 `cli/print.ts` 注释中提到，**无实现**

### 2.2 卡死 / 超时检测

- **流式 API idle watchdog**：`services/api/claude.ts:1868-1957` `STREAM_IDLE_TIMEOUT_MS = 90_000`（可 env 覆盖）+ `STALL_THRESHOLD_MS = 30_000`（仅打日志/事件不 abort）；需 `CLAUDE_ENABLE_STREAM_WATCHDOG` 才启
- **Remote 会话级无响应**：`hooks/useRemoteSession.ts:36-41 + 534-560` `RESPONSE_TIMEOUT_MS = 60_000`，compact 期 `COMPACTION_TIMEOUT_MS = 180_000`，超时插警告 + 自动 `reconnect()`
- **Local 子 agent 卡死**：`tasks/LocalAgentTask/LocalAgentTask.tsx:281-303` `killAsyncAgent` **仅由用户/上层取消触发**——**没有"N 秒无 tool call 自动 kill"探活**
- **未做**：grep `stuck|hang|lastActivity|lastSeen|staleness|heartbeat` 未发现独立的子 agent 健康检查模块

### 2.3 异常处置

- **kill 路径**：`tools/AgentTool/agentToolUtils.ts:638-656` `runAsyncAgentLifecycle` 的 `catch (AbortError)` 调 `killAsyncAgent` + 打 `tengu_agent_tool_terminated` reason `'user_kill_async'` —— **语义上是用户/abort 触发**
- **桥接/多会话 shutdown**：`bridge/bridgeMain.ts:1452-1463` 先 SIGTERM 等 `shutdownGraceMs`（默认 30_000ms）再 `forceKill`
- **SDK 空闲自动退出**：`utils/idleTimeout.ts` 仅当 `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` 合法时持续 idle 后 `gracefulShutdownSync()`

### 2.4 紧急消息穿透 / 通知分级

- **队列优先级（不是 IM 紧急）**：`types/textInputTypes.ts:276-290` `QueuePriority = now/next/later` 描述对话队列与是否打断 in-flight tool（`now` = Esc+发送），**不是跨通道紧急穿透**
- **终端通知**：`services/notifier.ts:40-70` 按 `preferredNotifChannel` 路由 iTerm2/Kitty/Ghostty/铃响等，**无 DND / 静音穿透 / urgent API**
- **"用户不活跃才提醒"（反向逻辑）**：`hooks/useNotifyAfterTimeout.ts:8-20` `DEFAULT_INTERACTION_THRESHOLD_MS = 6000`，近 6s 无交互才 `sendNotification`——**与"穿透 quiet"完全相反，是抑制打扰**
- **未做**：grep `urgent|dnd|doNotDisturb|notificationPriority` 无产品级紧急消息分级

### 2.5 优雅降级

- **Token 满 autocompact**：见 §2.1
- **`max_output_tokens` escalate**：`query.ts` 在特定 gate 下放大到 `ESCALATED_MAX_TOKENS`（一次性放大）
- **API/网关鲁棒性**：`FallbackTriggeredError`、streaming → non-streaming fallback、`tengu_model_fallback` —— **是 API 故障 fallback，不是"本机内存不足换小模型"**
- **未做**：grep `degrade|backpressure|smallerModel` 无对应"因本机资源换小模型"的逻辑

---

## 3. Codex 源码事实

**仓库**：`<upstream-workspace>/codex/`（核心在 `codex-rs/`）

### 3.1 资源监控

- **`/health` 端点**：`codex-rs/app-server/src/transport/websocket.rs:80-82, 140-143` `/readyz` + `/healthz` 处理函数恒返回 `200 OK`，**无 body、无系统资源采样**
- **TUI Runtime metrics**：`tui/src/chatwidget.rs` 中 `turn_runtime_metrics`、`collect_runtime_metrics_delta` 是**会话/API 侧运行时**展示，不是 OS 级资源
- **未做**：在 `<upstream-workspace>/codex/codex-rs` 下 grep `procfs`/`meminfo`/`sysinfo` 仅见 WSL/沙箱判断（`tui/src/clipboard_paste.rs` 读 `/proc/version`），**未见 thread CPU/内存采样**
- **未做**：grep `oom` 仅 `exec.rs` 注释，无实际 OOM 处理

### 3.2 卡死 / 超时检测

- **`TurnAbortReason` 三种**：`protocol/src/protocol.rs:3697-3703` `Interrupted | Replaced | ReviewEnded` —— **均偏会话/任务策略，不是资源类**
- **`Op::Interrupt` 用户中断**：`session/mod.rs:2919-2926` `interrupt_task()` 提交后 `abort_all_tasks(Interrupted)`
- **`wait_agent` 超时 V1 vs V2**：
  - V1（`multi_agents/wait.rs`）：等 agent **进入终态**（`wait_for_final_status` + `is_final`）—— 等结束超时
  - V2（`multi_agents_v2/wait.rs:55-57`）：仅等 mailbox 序号变化（`wait_for_mailbox_change` + `timeout_at`）—— **不保证等到 agent 终态**
- **默认/边界**：`multi_agents_common.rs:29-31` `MIN_WAIT_TIMEOUT_MS = 10_000` / `DEFAULT = 30_000` / `MAX = 3600_000`
- **未做**：grep `liveness|heartbeat|keepalive`（小写全词）无 agent 保活机制

### 3.3 异常处置

- **`SpawnReservation` Drop 释放**：`agent/registry.rs:331-339` 槽位预占 commit 失败时 Drop 自动 `fetch_sub` 释放 —— **解决"预占不 commit 时要释放"的并发记账**，不替代外部 kill
- **`interrupt_agent` 协作中断**：`multi_agents_v2/message_tool.rs:106-111` `followup_task` 可在 `interrupt=true` 时先发 `Op::Interrupt`
- **`agent_max_depth` 触顶**：`agent_jobs.rs:528-533` `RespondToModel` 错误拒绝 —— **不 kill 进程，模型可读地拒绝**
- **`agent_max_threads` 触顶（batch job）**：`agent_jobs.rs:641-648` 返回 `AgentLimitReached` 时把 item 标回 pending + `break` —— **推迟再试不是硬拒绝**
- **`reap_stale_active_items` worker 墙钟超时**：`agent_jobs.rs:933-960` 标 item failed + `shutdown_live_agent`

### 3.4 紧急消息穿透 / 通知分级

- **TUI 通知**：`tui/src/tui.rs:64-68` `should_emit_notification` 按 `NotificationCondition`（`Unfocused` vs `Always`）配合终端焦点决定是否发，**无 DND / 紧急分级**
- **OSC9 后端**：`osc9.rs` 中 `PostNotification` 发终端桌面通知转义
- **未做**：grep `urgent` 仅 `agent_tool.rs` 工具说明文案出现，**无代码级优先级队列**

### 3.5 优雅降级

- **Pre-sampling auto compact**：`turn.rs:728-755` `total_usage_tokens >= auto_compact_limit` 时 `run_auto_compact(..., CompactionReason::ContextLimit, ...)`
- **`ModelDownshift` inline compact**：`turn.rs:759-802` 切到更小 context window 模型时
- **TODO**：`turn.rs:144-147` 注释明确"尚未在压缩前把待注入大输入算进预算"——预估 preemptive compact **未做**
- **API/传输降级**：`turn_context.rs:594-605` `used_fallback_model_metadata` 时发 Warning；`client.rs:1519-1571` Responses WebSocket 不健康时永久切 HTTP —— **传输层降级，不是资源压力降级**
- **未做**：无统一 "degrade 模式" 状态机；无随 CPU/内存压力切小模型

---

## 4. Hermes Agent 源码事实

**仓库**：`<upstream-workspace>/hermes-agent/`

**为什么 Hermes 调研最重要**：与 Linnsy 场景**最像**（24/7 个人助理 + 多 IM + cron）。

### 4.1 资源监控

- **`/health` 简单 + 详细两层**：`gateway/platforms/api_server.py:723-746` `/health` 返回 ok JSON；`/health/detailed` 读 `gateway.status.read_runtime_status`，含网关状态/平台/活跃 agent 数/PID —— **业务状态，不是 OS 指标**
- **持久化运行时健康**：`gateway/status.py:232-272` `write_runtime_status` 写 `gateway_state.json`
- **多 IM 子服务 `/health`**：`gateway/platforms/{webhook,wecom_callback,sms,bluebubbles}.py` 都有；WhatsApp 桥接对 `127.0.0.1:.../health` 探测
- **磁盘**：
  - `tools/terminal_tool.py:78-105` `DISK_USAGE_WARNING_THRESHOLD_GB = 500`（`TERMINAL_DISK_WARNING_GB`），仅 scratch 目录体积**告警**（不自动清）
  - `plugins/disk-cleanup/` 按类别 + 年龄/大小**保留策略**清理（temp 7 天 / cron-output 14 天等）—— **无"剩余磁盘空间低于 X% 紧急清理"逻辑**
- **未做**：在 `gateway/` grep `cpu_percent|virtual_memory|meminfo|load_average` 均无匹配 —— **无主机级 CPU/内存监控**
- **未做**：`mcp_serve.py` grep `health` 无 HTTP 端点（stdio MCP 入口）

### 4.2 卡死 / 超时检测（Hermes 最成体系）

- **`IterationBudget`（硬预算非探活）**：`run_agent.py:188-214` 父子独立预算，子 cap `delegation.max_iterations` 默认 50；`run_agent.py:9548-9573` `budget_exhausted` 退出
- **网关 inactivity 超时**：`gateway/run.py:10190-10328` **`HERMES_AGENT_TIMEOUT = 1800s`**（30 min）+ `HERMES_AGENT_TIMEOUT_WARNING`，轮询 `get_activity_summary()["seconds_since_activity"]`，超时 `agent.interrupt(_INTERRUPT_REASON_TIMEOUT)` + 构造**用户可见诊断回复**
- **陈旧 `_running_agents` 驱逐**：`gateway/run.py:3137-3187` 按 idle 与 wall TTL 驱逐泄漏的 running 状态（防锁泄漏）
- **Cron inactivity 超时**：`cron/scheduler.py:889-964` **`HERMES_CRON_TIMEOUT = 600s`**（10 min），超时 `agent.interrupt("Cron job timed out (inactivity)")` + `raise TimeoutError`
- **子 agent 心跳回写父**：`tools/delegate_tool.py:461-487` 心跳线程**把子 agent 活动反映到父 `_last_activity_ts`**——避免 delegate 期间父被网关误判 idle ⭐ **设计很优雅**
- **API 流式 stale**：`run_agent.py:6629-6644` 一带 30s 心跳 touch `_last_activity_ts`
- **通道级 worker**：`gateway/platforms/signal.py:51-53` `HEALTH_CHECK_INTERVAL = 30.0` + `HEALTH_CHECK_STALE_THRESHOLD = 120.0` —— SSE 连接健康，非全局 agent 卡死

### 4.3 异常处置

- **`/stop` 软中断 + 强清**：注释明确"软 interrupt 对真 hung 无效"，需强制清 session / 释放锁（`_interrupt_and_clear_session` 等）
- **disk-cleanup**：仅 `quick()` 确定性删 + `deep()` 交互确认 —— **无"磁盘满阈值紧急清理"**
- **进程级自启**：`scripts/hermes-gateway:88-93` 生成 systemd unit `Restart=on-failure` + `RestartSec=30` —— **不是 always 而是 on-failure**
- **AIAgent 异常退出**：源码未见"立刻无状态 respawn"通用机制，依赖网关会话逻辑 + 下次消息驱动
- **子 agent 异常**：`delegate_task` 同步等 `run_conversation` 返回，`tools/delegate_tool.py:614-635` `except Exception` 返回 `{status: "error"}` JSON

### 4.4 紧急消息穿透 / 通知分级（**0 实现**）

- **未做**：核心 Python 代码 grep `dnd|do_not_disturb|quiet_hours|urgent|emergency`（IM 维度）**无对应实现**；`optional-skills/` 中 `dnd` 字符串是第三方 BCI 文档，非 Hermes 逻辑
- **PRIORITY 是实现分支命名不是用户配置**：`gateway/run.py:3129-3432` 已 running agent + 普通文本默认走 interrupt 路径（logger 称 `PRIORITY interrupt`）—— **是默认行为名不是紧急级别**
- **`HERMES_BACKGROUND_NOTIFICATIONS`**：`_load_background_notifications_mode` 用于 terminal 后台完成/watch 通知过滤，**不是用户睡眠勿扰**
- **OpenAI `service_tier = "priority"`**：是供应商加速，非 Hermes 自研

### 4.5 优雅降级

- **`ContextCompressor`**：`agent/context_compressor.py`（与用户已知一致）
- **`_try_activate_fallback`**：`run_agent.py:6774-6785` 当前模型失败重试后切 fallback 链 —— **故障切换不是降载**
- **未做**：在 `gateway/` 找不到按负载丢弃通道的实现；`tools/browser_tool.py` 截图清理 throttle 是局部优化

---

## 5. OpenClaw 源码事实

**仓库**：`<upstream-workspace>/openclaw/`

### 5.1 资源监控

- **`/health` 分层**：`src/gateway/server-http.ts:179-184` `/health` `/healthz` → live；`/ready` `/readyz` → ready（可 503，按本地/鉴权决定细节）；`server-http.ts:315-337` ready 走 `getReadiness`
- **`getHealthSnapshot`**：`src/commands/health.ts:215-236` 聚合 agent 顺序 / `probeAccount` / session 文件摘要 —— **不是机器级 CPU/内存/磁盘**
- **子 agent 数量**：`maxChildrenPerAgent` 在 spawn 时与活跃子 run 数比较（见 §5.5 `subagent-spawn.ts:439-446`）
- **未做**：在 `src/gateway` grep `memoryUsage|freemem|loadavg` 无 Node 资源采样
- **未做**：核心 Gateway 无 `prometheus` / `/v1/metrics` 实现（仅 `extensions/nostr` 等扩展中有 metrics 字样）
- **未做**：在 `src` grep `oom|disk_free|df ` 无运行时资源告警

### 5.2 卡死 / 超时检测

- **`waitForAgentRun` / `agent.wait`**：`src/agents/run-wait.ts:118-150` 通过 RPC 阻塞等，`timeoutMs` 显式截断 —— **被动超时不是主动探活**
- **`agent.wait` 默认 30s**：`src/gateway/server-methods/agent.ts:1021-1098` 可返 `status: "timeout"`
- **`runTimeoutSeconds` 语义**：`src/agents/timeout.ts:24-47` `overrideSeconds === 0` = 无限时
- **Announce 超时默认 120s**：`src/agents/subagent-announce-delivery.ts:46-74` `DEFAULT_SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120_000`
- **`SubagentRunRecord` 字段**：`src/agents/subagent-registry.types.ts:6-44` 含时间戳 / 结果 / announce 重试 —— **无 `heartbeat` / `lastSeen` 独立字段**
- **IM 通道半死检测**：`src/gateway/channel-health-policy.ts:58-99` `evaluateChannelHealth` 定义 `stuck`（busy 过久）+ `stale-socket`（长期无事件） —— **连接层健康，不是 agent 卡死**

### 5.3 异常处置

- **IM 通道半死自动重启**：`src/gateway/channel-health-monitor.ts:100-170` 不健康 → `stopChannel` + `startChannel`，**带每小时重启上限**（默认 10 次）；`src/gateway/server-runtime-services.ts:28-45` `channelHealthCheckMinutes === 0` 时不启
- **subagent-registry sweeper**：`src/agents/subagent-registry.ts:550-599` 每 60s 一次，处理 `cleanupCompletedAt > SESSION_RUN_TTL_MS` 的 TTL 删除 + 到期归档 —— **是会话卫生不是"发现卡死就杀"**
- **进程级自启**：`src/daemon/systemd-unit.ts:67-86` systemd unit `Restart=always` + `RestartSec=5` + `StartLimitBurst=5/StartLimitIntervalSec=60` + `RestartPreventExitStatus=78` + `KillMode=control-group`（防孤儿子进程）—— **比 Hermes `on-failure` 更激进**
- **HTTP 杀会话**：`POST /sessions/{key}/kill` 走鉴权 + owner/admin 规则

### 5.4 紧急消息穿透 / 通知分级（**0 用户级实现**）

- **未做**：在 `src` grep `quietHours|doNotDisturb|do_not_disturb` 无匹配 —— **无产品级勿扰**
- **未做**：IM 入站路径 grep `urgent|emergency` 作路由策略无；`priority` 大量出现在插件 hook / 媒体能力 / APNs，**不等同于"用户消息分级投送"**
- **APNs 推送层优先级**：`src/infra/push-apns.ts:1038-1059` `priority: "10"` 高 / `5` 背景 —— **推送通道层非用户语义层**
- **TaskNotifyPolicy（任务系统层）**：`src/tasks/task-registry.types.ts:22-24` `done_only | state_changes | silent` —— **任务通知不是 IM 消息分级**
- **Node 端通知入会话 + 立即心跳**：`src/gateway/server-node-events.ts:587-594` `notifications.changed` 入队 + `requestHeartbeatNow` —— "有通知尽快心跳处理"
- **Discord `dnd`**：`zod-schema.providers-core.ts` 等仅作在线状态枚举（**presence 展示**，**非用户勿扰窗**）

### 5.5 优雅降级

- **`lightContext` heartbeat**：`src/infra/heartbeat-runner.ts:1007-1020` 由配置 `heartbeat.lightContext === true` 决定 —— **非 CPU/内存压力自动切**
- **子 agent 槽满**：`src/agents/subagent-spawn.ts:439-446` `activeChildren >= maxChildren` 直接返 `forbidden` —— **不排队不降级**
- **未做**：grep `degrade|backpressure|pressure` 无全局负载调度的实现

---

## 6. 横向对比表（5 维度 × 4 项目）

| # | 维度 | CC | Codex | Hermes | OpenClaw | Linnsy 启示 |
|---|------|----|------|--------|----------|------------|
| 1 | `/health` 端点 | ❌ | ✅ 仅 200 (`websocket.rs:80-82`) | ✅ 简单+详细 (`api_server.py:723-746`) | ✅ live/ready 分层 (`server-http.ts:179-184`) | ✅ **学 Hermes/OpenClaw**：分层 `/health` + 详细业务状态 JSON |
| 2 | 主机资源监控（CPU/Mem/Disk） | ❌ | ❌ | ❌ | ❌ | **0 家做** → Linnsy Phase 1 也不做（主人 §2 "危险"被印证） |
| 3 | 进程内存预警 | ⚠️ 仅 UI 1.5/2.5GB 两档 (`useMemoryUsage.ts:11-35`) | ❌ | ❌ | ❌ | 仅 CC，且仅 UI → 不学 |
| 4 | 磁盘容量监控 | ⚠️ Bash 输出 size watchdog (`ShellCommand.ts:52-54`) | ❌ | ⚠️ scratch 体积告警 (`terminal_tool.py:78-105`) + retention (`disk-cleanup/`) | ❌ | **学 Hermes 模式**：体积告警 + retention，不做"满阈值紧急清理" |
| 5 | Token autocompact | ✅ `AUTOCOMPACT_BUFFER_TOKENS=13_000` (`autoCompact.ts:62-90`) | ✅ `auto_compact_limit` (`turn.rs:728-755`) | ✅ ContextCompressor | - | **3 家共识做** → Linnsy Phase 1 必做 |
| 6 | 流式 API idle 检测 | ✅ 90s + 30s stall (`claude.ts:1868-1957`) | - | ✅ 30s 心跳 touch | - | linnkit 路线图 |
| 7 | 会话级 inactivity 超时 | ✅ Remote 60s/180s (`useRemoteSession.ts:36-41`) | - | ✅ **`HERMES_AGENT_TIMEOUT=1800s`** (`gateway/run.py:10190-10328`) | ✅ `agent.wait` 30s default (`agent.ts:1021-1098`) | **学 Hermes**：30 min 默认 + 用户可见诊断回复 |
| 8 | Cron/长任务超时 | - | ✅ `reap_stale_active_items` (`agent_jobs.rs:933-960`) | ✅ **`HERMES_CRON_TIMEOUT=600s`** (`scheduler.py:889-964`) | ✅ `runTimeoutSeconds` + `announceTimeoutMs=120s` (`subagent-announce-delivery.ts:46-74`) | **3 家共识** → Linnsy 学 |
| 9 | stale 注册表驱逐 | - | ✅ | ✅ `_running_agents` 陈旧驱逐 (`gateway/run.py:3137-3187`) | ✅ `subagent-registry sweeper` 60s (`subagent-registry.ts:550-599`) | **3 家共识** → Linnsy 学 |
| 10 | **子→父心跳回写** | - | - | ✅ **`delegate_tool.py:461-487`** ⭐ | - | ⭐ **Hermes 独有的优雅设计**——Linnsy 必学，避免父在子运行时被误判 idle |
| 11 | 主动探活 | ❌ | ❌ | ❌ inactivity-based 是被动 | ⚠️ IM 通道 lastEventAt | **0 家做主动探活** → Linnsy 不做 |
| 12 | **自动 kill** | ❌ 仅 user `killAsyncAgent` (`LocalAgentTask.tsx:281-303`) | ❌ 仅 user `Op::Interrupt` (`session/mod.rs:2919-2926`) | ✅ inactivity 后 `agent.interrupt` (`run.py` + `scheduler.py`) | ✅ 通道半死自动重启 (`channel-health-monitor.ts:100-170`) | **kill 都是用户/timeout 触发，从不基于"系统资源紧张"** → 印证主人 §2 "危险"判断 |
| 13 | 进程重启 | ❌ | ❌ | ✅ systemd `Restart=on-failure` + `RestartSec=30` (`scripts/hermes-gateway:88-93`) | ✅ systemd `Restart=always` + `KillMode=control-group` (`systemd-unit.ts:67-86`) | **2 家共识依赖 systemd** → Linnsy 不在应用层做，提供 unit 模板 |
| 14 | 槽位记账 | - | ✅ `SpawnReservation` Drop 释放 (`registry.rs:331-339`) | - | ✅ `maxChildrenPerAgent` 直接 forbidden 不排队 (`subagent-spawn.ts:439-446`) | Linnsy 学 OpenClaw 简单语义；Codex Drop 是 Rust 特性不可移植 |
| 15 | **用户级"紧急消息"字段** | ❌ | ❌ | ❌ | ❌ APNs `priority:10` 是推送层 | **0 家做** ⚠️ **Linnsy 必须自创** |
| 16 | **勿扰 / quiet hours** | ❌ `useNotifyAfterTimeout.ts` 是**反向逻辑**（在场少打扰，`DEFAULT_INTERACTION_THRESHOLD_MS = 6000`） | ⚠️ `Unfocused` 才弹 (`tui.rs:64-68`) | ❌ | ❌ `dnd` 仅 Discord presence | **0 家做用户级勿扰** ⚠️ **Linnsy 必须自创** |
| 17 | **多通道兜底（IM 不通→短信/电话）** | ❌ | ❌ | ❌ | ❌ APNs 是单通道 | **0 家做** ⚠️ Phase 2 评估 |
| 18 | 因系统资源换小模型 / 减并发 | ❌ | ❌ batch 槽满推迟 | ❌ fallback 是故障驱动 | ❌ heartbeat lightContext 是配置驱动 | **0 家做** → Linnsy 不做 |

---

## 7. 关键产品判断

### 7.1 4 家在 §5.4 上的"做/不做"格局

**4 家共识"做"的事**（Linnsy 直接学）：
1. **inactivity-based timeout**（不是主动探活）—— 父级 30 min / cron 10 min（Hermes 数字最优雅）
2. **stale 注册表驱逐 sweeper**（防内存/锁泄漏）
3. **systemd / launchd 自启**（应用层不自管）
4. **kill 决策都需用户触发或 timeout 触发**（**反向印证主人 §2 "危险"判断**）
5. **Token 满 autocompact**（4 家上下文管理共识）
6. **`/health` 端点**（多数有，OpenClaw live/ready 分层最清晰）

**4 家共识"不做"的事**（Linnsy 也不做）：
1. **主机级 CPU/内存/磁盘自动采样**（0 家做）
2. **基于系统资源压力自动 kill / 降级**（0 家做）
3. **主动探活**（0 家做）
4. **应用层"自挂自起"**（全部依赖 systemd）

**4 家盲区**（**Linnsy 必须自创**——这恰是 Linnsy "是一个人" 差异化的关键）：
1. **用户级"紧急消息"分级**（0 家做）⚠️
2. **勿扰窗 / quiet hours**（0 家做，CC 甚至是反向逻辑）⚠️
3. **多通道兜底**（IM 不通时短信/电话；0 家做）⚠️

### 7.2 为什么 4 家全无勿扰/紧急穿透？

**核心原因**：4 家**都不是"人"**——
- CC / Codex 是 IDE 助手 → 主人在场，没有"勿扰"概念
- Hermes / OpenClaw 是个人助理 → 但定位是"工具"，不是"会照顾主人作息的人"

CC 的 `useNotifyAfterTimeout`（"在场才少打扰"）是**反向逻辑**——它假设"用户在场"是默认，"勿扰"是默认行为；而 Linnsy 假设"用户不在场"是常态，"主动打扰"是默认行为，但**主人睡觉时除非真急事不能吵**。

→ Linnsy 在 §5.4 的差异化**恰好在 4 家全无的地方**，符合 §1.1 "是一个人" 哲学。

### 7.3 Hermes 的"子→父心跳回写"是最优雅的发现 ⭐

`tools/delegate_tool.py:461-487` 解决的问题：父 agent 在 `delegate_task` 期间**自身的 `_last_activity_ts` 会冻结**（因为父在等子），导致网关 inactivity 监测**误判父 idle**。Hermes 用一个心跳线程**把子的活动反映到父**——这是 Linnsy 实现 §5.4 拍板 #2 时**必须借鉴**的设计点。

### 7.4 OpenClaw vs Hermes 在 §5.4 上谁参考价值更高？

**对 Linnsy 最像的是 Hermes**（24/7 + 多 IM + cron + 已成体系的 inactivity 监测），但 **OpenClaw 在 systemd unit 与 IM 通道半死监控上更完整**。Linnsy 的最佳策略是**两家组合**：

- inactivity timeout + 子→父心跳：学 **Hermes**
- systemd unit 模板 + IM 通道半死自重启：学 **OpenClaw**
- `/health` live/ready 分层：学 **OpenClaw**（更清晰）+ Hermes 详细 JSON（更丰富）

---

## 8. Linnsy §5.4 拍板姿势映射（详见 `linnsy/01b-product-scenarios.md` §5.4）

| 拍板条目 | 来源 |
|---|---|
| #1 系统资源监控只做被动观测 | 4 家共识不做主机级 + 主人 §2 "危险" 印证 |
| #2 inactivity-based timeout | 学 Hermes `HERMES_AGENT_TIMEOUT=1800s` + Hermes 子→父心跳回写 |
| #3 卡死处置永不自动 kill | 4 家共识 kill 用户/timeout 触发 |
| #4 systemd / launchd 自启 | 学 OpenClaw `Restart=always` + `KillMode=control-group` |
| #5 通知分级四档（紧急/重要/普通/沉默） | **4 家全无** → Linnsy 自创 |
| #6 勿扰窗 + 紧急穿透 | **4 家全无** → Linnsy 自创 |
| #7 仅做 Token autocompact | 学 4 家共识（CC `AUTOCOMPACT_BUFFER_TOKENS=13_000` 模式） |

---

## 9. 残留 / 后续

- 当 Linnsy 进入"实现阶段"时，回头细读 `tools/delegate_tool.py:461-487` 完整实现 + `gateway/run.py:10190-10328` 完整 idle 监测循环
- Phase 2 评估"多通道兜底"时，调研 Twilio / WeChat 公众号 / 短信网关 SDK
- Phase 2 评估"模型自动降级"时，先看 alpha 阶段是否真出现"父子 token 满到顶 N 次"高频场景
- 长期：当 Linnsy 自己跑 alpha 一段时间后，回头看"勿扰 + 紧急穿透"是否真的解决了 4 家的盲区——若没解决，反向输出给社区
