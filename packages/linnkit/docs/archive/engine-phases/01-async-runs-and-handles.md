# 01 · Async runs and run handles

> **状态**：✅ 决策定稿，等候实施  
> **决策**：✅ **方案 B**（engine 留 RunHandle 协议、信息丰富、不做实现/不做工具）  
> **创建日期**：2026-04-20  
> **最近更新**：2026-04-21（按 [`audit §1.4`](./00-engine-scope-audit.md) "engine 留接口、不做工具、信息丰富" 新原则重写——原方案 A 调研结论 100% 仍成立，但应用方式反过来：三方都在产品层重复造轮恰好证明 engine 应主动留接口）

---

## 1. 问题与场景

### 1.1 这个 topic 解决什么

回答一个问题：**当一次 Agent run 不能（或不应）阻塞调用方时，engine 应该提供什么协议？**

具体场景：

- **场景 A：长任务 tool**  
秘书在跟你聊天。你说"让 Codex 改这个 repo"。Codex 执行可能 5-30 分钟。秘书不应该挂在那儿等——它应该立即回你"好的，开始了"，然后保持可继续聊别的；Codex 完成后再告诉你结果。
- **场景 B：异步子 agent**  
秘书 spawn 多个子任务并行执行（"研究这个、订张机票、整理上周的待办"），自己继续接收新消息。子任务各自完成后回报。
- **场景 C：定时任务触发**  
Cron 命中时，触发一次 agent run。run 期间用户可能也在跟秘书聊天。两个 run 不能互相阻塞。
- **场景 D：上层查询子 run 状态**  
用户问"你刚才让 Codex 做的事进展怎样了？"，秘书需要能查询到 in-flight 子 run 的当前状态（运行/完成/失败/产出的中间事件）。
- **场景 E：守护进程重启恢复**  
daemon 半夜重启。重启前在跑的子 run、待 fire 的 cron、待答复的子 agent 应该能恢复或被妥善处理。

### 1.2 这个 topic **不**解决什么

- 不解决 cron 子系统怎么写（→ `secretary/05-scheduler-subsystem.md`）
- 不解决具体外部 agent (Cursor/Codex/...) 怎么对接（→ `engine/05-external-agent-tool-protocol.md` + `secretary/11-external-agent-tools.md`）
- 不解决跨重启的具体 store 实现（→ `engine/06-checkpointer-and-persistence.md`）
- 不解决 session/tenancy 模型（→ `engine/02-session-and-tenancy.md`）

本 topic 只回答：**run lifecycle 的协议长什么样**。

### 1.3 为什么放在 engine 而不是产品层

候选答案两种，正是本 topic 要决策的：

- 如果 engine 提供 `RunHandle` 协议：所有消费者一致受益（Linnya 桌面 agent 也可以异步调起 deep_research）
- 如果不提供：每个产品自己写 wrapper，重复劳动；但 engine 保持纯净

---

## 2. 当前 Linnya 现状

### 2.1 主入口 (Linnya host 侧)

文件：`src/app-hosts/linnya/adapters/flow/`

- `FlowOrchestrator.next()` —— 一次"前端发请求 → 后端跑一轮 → SSE 推回"的入口
- `AgentRunnerService.run()` —— 真正驱动 graph 执行
- 关键链路：`prepareForRun → graphExecutor.prime → graphExecutor.runUntilYield → finalize`

**形态**：所有 run 都是 **request-response + SSE stream**。前端发起，后端跑完一轮（直到 `wait_user` / `answer` / `pause`）才返回。**没有"后台 detached run"的概念**。

### 2.2 GraphExecutor

文件：`src/agent/runtime-kernel/graph-engine/engine.ts`

```ts
export class GraphExecutor {
  async prime(conversationId: string, local, nodeId = 'user'): Promise<void>
  async runUntilYield(conversationId: string): Promise<{ events; checkpoint; stepCount }>
  async setNode(conversationId, nodeId, localPatch?): Promise<void>
  async peekCheckpoint(conversationId): Promise<EngineState | null>
}
```

**形态**：

- `runUntilYield` 是阻塞的 async 函数；调用者必须 `await` 它结束
- 没有 RunHandle / runId / status 概念
- 同一 `conversationId` 不应并发跑两次（没有显式锁，但 engine 行为对此假设）
- 通过 `signal: AbortSignal` 在 `local` 里支持中断（`engine.ts:97-102`）

### 2.3 子 run（child runs）

文件：`src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts`

```ts
export class InternalAgentInvoker {
  async invoke(config: InternalAgentInvokeConfig): Promise<InternalAgentInvokeResult>
}
```

**形态**：

- 父 graph 的某个 tool 调用 `internalAgentInvoker.invoke()`，**完全同步**等子 graph 跑完
- 子 graph 用自己的 `MemoryCheckpointer`（in-process only，不跨 daemon 重启）
- 子的 stream events 通过 `subrunTracePublisher` 转回父的 SSE 流
- 完成后 `await checkpointer.clear(internalConversationId)` —— **clean up，没有 registry，没有"将来回来查"** 的概念
- 父 tool 拿到完整 `InternalAgentInvokeResult` 才能继续

### 2.4 Pause / Resume 协议

文件：`src/agent/runtime-kernel/graph-engine/nodes/waitUserNode.ts`

- `WaitUserNode` 是 graph 唯一的"暂停"节点
- 工具用 `pendingInteractionSpec` 写入要 pause 的元信息
- 当 graph route 到 `wait_user` 时，`runUntilYield` 返回；checkpointer 保存了完整状态
- 下次外部再调 `runUntilYield`（带新的 user input event），graph 从 `wait_user` 恢复继续

**关键发现**：**Pause/Resume 协议已经存在**——是 `wait_user` 节点。但它的 trigger 是"等用户输入"，没有"等外部异步事件"的语义。

### 2.5 持久化

- 顶层 conversation：当前由宿主侧的 `Linnya EventStore` 持久化 RuntimeEvent，可重放；**这不等于 engine 已经拥有通用 `EventStore` port**
- 子 run：`MemoryCheckpointer` only，**不持久化**
- 没有"in-flight run registry"

### 2.6 总结：现状能做什么、不能做什么


| 需求                                | 现状能否支持 | 说明                                                |
| --------------------------------- | ------ | ------------------------------------------------- |
| Pause + 等用户输入恢复                   | ✅      | `wait_user` 节点已经做了                                |
| Sync 调子 agent                     | ✅      | `InternalAgentInvoker`                            |
| 长任务 tool 立即返回，run 结束              | ✅      | tool 返回 `{started: true, taskId}`，run 自然结束        |
| 后续从外部注入新 user message 触发下一轮       | ✅      | host 调 FlowOrchestrator 即可                        |
| 上层从外部查询某 conversation 的当前状态       | ⚠️     | 可以 `peekCheckpoint`，但没有 status 抽象、没有 in-flight 标识 |
| 上层查询某子 run 状态                     | ❌      | 子 run 没有 ID 暴露给外部、没有 registry                     |
| 在父 run 进行中查询父 run 自己              | ❌      | 没有这个概念，父 run 是 await 的 Promise                    |
| 跨 daemon 重启恢复 in-flight 子 run     | ❌      | MemoryCheckpointer                                |
| Detached run（创建一个 run 但**不**等它结束） | ❌      | 没有                                                |


---

## 3. 参考项目做法

### 3.1 OpenClaw（已调研）

源：`99-research-notes/openclaw.md` §3.4

**核心做法**：

- `sessions_spawn` 工具立即返回 `{status: "accepted", childSessionKey, runId}`，**不阻塞**
- subagent registry（`src/agents/subagent-registry.ts`）持久化 in-flight runs 到盘
- 重启时 `restoreSubagentRunsFromDisk`
- Gateway 协议有 `agent.wait` RPC 显式等待某 runId 完成
- 父拿子结果走 **announce/push**：子完成后注入下一轮 system message
- **系统提示中明确禁止 LLM 轮询 `sessions_list`**——靠提示工程而非协议保障

**对我们的启发**：

- ✅ 子 run 必须有 `runId` + 可外部查询的 status —— 强烈借鉴
- ✅ in-flight registry 持久化跨重启 —— 借鉴
- ✅ 完成走 announce 而非轮询 —— 借鉴**意图**，但实现上我们应该用协议保证而非提示工程
- ⚠️ "session-key 含 subagent 前缀"——属于 session model 设计（在 topic 02 讨论）
- ⚠️ ACP 路径单独处理 —— 跟 external-agent-tool 相关（topic 05）

### 3.2 Codex CLI（已调研 2026-04-20）

源：`99-research-notes/codex.md` §3.1-3.7、§9

#### Codex 的核心做法

**1. 主 loop = 双层结构（非 async generator）**：

```rust
// codex-rs/core/src/session/handlers.rs:1005-1012
pub(super) async fn submission_loop(
    sess: Arc<Session>,
    config: Arc<Config>,
    rx_sub: Receiver<Submission>,
) {
    while let Ok(sub) = rx_sub.recv().await {
        // 按 Op 分发：UserTurn / ExecApproval / Interrupt / Shutdown
```

外层 `submission_loop` 是 `Op` channel 驱动的 actor loop；内层 `try_run_sampling_request` 是 retry 循环 + stream 迭代。**两层职责清晰分离**：外层驱动会话状态机，内层跑单次 LLM 采样 + stream。

**对比 CC**：CC 用单个 async generator 同时做两件事；Codex 用 channel 把"会话事件驱动"和"单 turn 推理"解耦。**这更像我们的图引擎天然拓扑**（调度层 + 节点执行层）。

**2. 子代理分两套工具族（重要设计取舍）**：

- **`agent_tool`（协作原语）**：`spawn_agent` / `send_input` / `wait_agent` / `list_agents` / `close_agent`。`spawn_agent` 返回立即；`wait_agent` 阻塞在 mailbox；inter-agent 通信走 mailbox。
- **`agent_job_tool`（批处理）**：`spawn_agents_on_csv` + `report_agent_job_result`。**主调用阻塞**直到所有 row 处理完；worker 用专用 `report_*` 结构化上报。

**工具 description 原文**（`tools/src/agent_tool.rs`）：

```
Spawns an agent to work on the specified task. If your current task is 
`/root/task1` and you spawn_agent with task_name "task_3" the agent will 
have canonical task name `/root/task1/task_3`.
```

Codex 区分了**灵活异步编排** vs **结构化批处理**，两类任务用两套工具。CC 则把它们揉在一个 `AgentTool` 里用 feature flag 区分。

**3. 子代理结果通过 `<subagent_notification>` 注入**：

与 CC 的 `<task-notification>` XML 是**独立收敛出的同一协议**——两个顶级产品不约而同选择了同一形态。方案 A 的跨产品证据**强度达到顶点**。

**4. `AgentPath` 树形命名空间**：

```rust
// protocol/src/agent_path.rs
impl AgentPath {
    pub const ROOT: &str = "/root";
    pub fn join(&self, agent_name: &str) -> Result<Self, String>
    pub fn resolve(&self, reference: &str) -> Result<Self, String>
    // 支持 "/root/task1/task_3" 绝对路径 + "task_3" 相对路径
}
```

传播通过 `AgentRegistry::agent_tree: HashMap<String, AgentMetadata>`（含 `agent_path`、`agent_id: ThreadId`）。**与 CC team（扁平小组 + lead_session_id）形成对比**：Codex 是真正的树形路径 + 相对解析；CC 是扁平邮箱组。

对 secretary 来说 Codex 的设计更扩展：多代理协作时有清晰的"作用域"概念（`/root/research/subtopic_1`）。

**5. Delegate bridge**（`core/src/codex_delegate.rs`）：

该文件**并没有 `CodexDelegate` struct**，而是提供桥接函数：
- `run_codex_thread_interactive` / `run_codex_thread_one_shot`
- `forward_events` / `forward_ops`

核心职责：**把子 agent 的审批类事件（exec approval / patch approval / permission / request_user_input）上浮到父 Session 决策**，其余事件透传。这是 CC 没有明确写出来的模式——我们应该引入。

**6. Thread 状态机**（来自 `app-server-protocol/src/protocol/v2.rs`）：

```rust
pub enum ThreadStatus {
    NotLoaded,
    Idle,
    SystemError,
    Active { active_flags: Vec<ThreadActiveFlag> },
}

pub enum ThreadActiveFlag {
    WaitingOnApproval,
    WaitingOnUserInput,
}
```

**极简且正确**。我们如果要在 host 层做 TaskRecord，状态枚举可以直接参考。

**7. 协议层"单 Session 单 Task"约束**：

Codex 协议文档明确：**一个 Session 同时只能有一个正在运行的 Task**。并行任务 = 多个 thread（ThreadManager HashMap）。这与 linnsec 场景直接契合——一个 conversation 一次一个 turn，多并发就开多个 thread。

**8. Cloud Tasks（云端 detached run 的产品形态）**：

`cloud-tasks` 子命令 = `Exec` / `Status` / `List` / `Apply` / `Diff`。流程：**本地 CLI 提交 task + env_id → 云端跑 → 拿回 diff → 本地 apply**。这正好是 linnsec 的"dispatch 到外部执行 → apply 回本地"的参考实现。

#### 对我们的启发

- ✅ **双层循环**对我们的图引擎天然契合：调度器（外层 Op 队列）+ 节点执行（内层 LLM stream）。不需要强行套 async generator
- ✅ **`agent_tool` vs `agent_job_tool` 分工**：linnsec 第一阶段只需要 `agent_tool` 等价物（spawn / wait / close），CSV 批处理延后
- ✅ **`<subagent_notification>` XML 注入** ← 与 CC `<task-notification>` 互为独立证据，方案 A 几乎铁板钉钉
- ✅ **AgentPath 树形命名空间**：我们的 hierarchical agents 设计直接照搬 `/root/a/b/c` + relative resolve
- ✅ **Delegate bridge 把子权限上浮到父 UI**：我们的 `WaitUserNode` 可演化为"任意层级 pause 都冒泡到顶层 session"
- ✅ **ThreadStatus 枚举**：`NotLoaded / Idle / SystemError / Active{flags}` 直接可用
- ✅ **"单 Session 单 Task"协议约束**：减少状态机复杂度
- ⚠️ Codex 没有 engine-level RunHandle：它也是产品层（app-server + JSON-RPC）暴露的 `thread/*` + `turn/*` 方法——这再次验证方案 A
- ⚠️ Cloud tasks 是产品层 dispatch 概念，不要误解为 engine 需要的能力
- ⚠️ `AgentIdentity`（云端 ed25519 keypair）与 `AgentPath`（编排路径）**是两种 ID**，不要混淆。我们的 `runId` / `taskId` / `sessionKey` 也应分开建模

### 3.3 Claude Code（已调研 2026-04-20）

源：`99-research-notes/claude-code.md` §3.1-3.5、§10

#### CC 的核心做法

**1. 主 loop 不是图引擎**：`src/query.ts` 用 **async generator + `while(true)` + 注入 `deps.callModel`**。事件层次 `StreamEvent / Message / TombstoneMessage / ToolUseSummaryMessage`。退出条件：`!needsFollowUp` (扫流中 `tool_use` 块) / `maxTurns` / `taskBudget` / abort。

**2. 子 agent = 同一个 `query()` + 不同 `ToolUseContext`**：`runAgent` 就是 `for await (const message of query({...}))`——只是 `agentId`、工具集、模型、abort 策略不同。**这比"另起 engine 实例"清爽**。

**3. `Task` 抽象与计算解耦**——CC 的 `Task` 接口出乎意料地小：

```ts
// src/Task.ts:72-76
export type Task = {
  name: string
  type: TaskType
  kill(taskId: string, setAppState: SetAppState): Promise<void>
}
```

**`Task` 不是计算单元，是 UI presence + lifecycle (kill) + disk output 的归一抽象**。同一个 `Task` 接口下挂着 `LocalAgentTask` / `InProcessTeammateTask` / `LocalMainSessionTask` / `LocalShellTask` / `RemoteAgentTask` / `DreamTask`。这意味着：**CC 把"在 UI 上显示的可 kill 的长活"和"实际推理执行"分开**——Dream 任务"消失"在 UI 上不会让推理停止，反过来推理失败也不会让 UI 卡死。

**4. 异步 vs 同步 = 一组条件而非协议形态**：

```ts
// src/tools/AgentTool/AgentTool.tsx:555-567
const forceAsync = isForkSubagentEnabled();
const assistantForceAsync = feature('KAIROS') ? appState.kairosEnabled : false;
const shouldRunAsync =
  (run_in_background === true ||
   selectedAgent.background === true ||
   isCoordinator ||
   forceAsync ||
   assistantForceAsync ||
   (proactiveModule?.isProactiveActive() ?? false))
  && !isBackgroundTasksDisabled;
```

异步路径：tool 立即返回 `{isAsync: true, status: 'async_launched', agentId, outputFile}`，注册到 `appState.tasks`，**主 loop 不阻塞**。同步路径：在父 generator 里 `for await` 子 generator，结果汇总返回。

**5. AbortController 策略**：

```ts
// src/tools/AgentTool/runAgent.ts:520-528
const agentAbortController = override?.abortController
  ? override.abortController
  : isAsync
    ? new AbortController()           // async: 全新独立 controller
    : toolUseContext.abortController; // sync: 共享父 controller
```

**6. 父拿子结果走"announce + system 注入下一轮"**：子完成后，CC 把 `<task-notification>` XML 注入主会话的下一轮 user message。**没有"父代码 await 子完成"的设计**，全靠这条注入协议。

**7. `coordinator` 模式 = 系统提示 + 强制异步**：`src/coordinator/coordinatorMode.ts` 只有一个文件，里面就是检查 env flag + 返回固定的 system prompt（描述 `<task-notification>` 协议、禁止替 worker 编造结果等）。**没有分布式调度器**。

**8. KAIROS / 常驻 daemon 模式默认全部异步**——注释：

> Synchronous subagents hold the main loop's turn open until they complete — the daemon's inputQueue backs up, and the first overdue cron catch-up on spawn becomes N serial subagent turns blocking all user input.

**这条是给我们设计 secretary 的金句**：常驻接消息的 daemon **不能默认同步**。

#### 对我们的启发

- ✅ **方案 A 完全可行且生产级**——CC 就是用"立即返回 + 注入下一轮"做的，跑了上千万用户
- ✅ **`Task` 抽象与推理解耦**——这个分层我们之前没有考虑，值得引入：`RunHandle`（计算）+ `TaskRecord`（产品/UI）通过 ID 关联但生命周期独立
- ✅ **常驻 daemon 必须默认 async spawn**——KAIROS 经验直接告诉我们 secretary 默认的 sub-agent 必须 async
- ✅ **Sync 路径仍要保留**——短任务、强一致需求时 sync 更简单
- ⚠️ CC 没有暴露 `RunHandle` API 给外部进程，但有 `taskId` 在 AppState 里——**说明 in-process 用 Map 就够，跨进程才需要协议**。这与方案 A vs B 的取舍直接相关：**如果 secretary 完全是单进程 daemon，方案 A 就够；如果要 IDE 客户端等外部查 run 状态，需要方案 B**
- ⚠️ "system 注入下一轮"模式要求外部 caller 有能力反向注入新 user message——我们 host 的 `FlowOrchestrator.next()` 已经支持，路径通的

### 3.4 Hermes Agent（已调研 2026-04-21）

源：`99-research-notes/hermes.md` §4、§5.7、§11

#### Hermes 的核心做法

**1. 主循环 = 经典同步 ReAct（既不是 generator 也不是 actor）**：

```python
# run_agent.py:9548-9573
while (api_call_count < self.max_iterations and self.iteration_budget.remaining > 0) or self._budget_grace_call:
    if self._interrupt_requested:
        interrupted = True
        _turn_exit_reason = "interrupted_by_user"
        break

    api_call_count += 1
    if self._budget_grace_call:
        self._budget_grace_call = False
    elif not self.iteration_budget.consume():
        _turn_exit_reason = "budget_exhausted"
        break
    # ... call model, process tool_calls, append to messages ...
```

**这是"第三种生产形态"**：CC = async generator / Codex = channel actor / Hermes = 经典 sync while。**三种形态都能跑通**——说明主循环形态本身**不是设计的核心矛盾**，关键还是上下游的协议形态。

**2. IterationBudget 树形预算**（重要洞察）：

```python
# run_agent.py:188-229
class IterationBudget:
    """Each agent (parent or subagent) gets its own IterationBudget.
    The parent's budget is capped at max_iterations (default 90).
    Each subagent gets an independent budget capped at delegation.max_iterations
    (default 50) — total iterations across parent + subagents can exceed parent's cap.
    """
    def refund(self) -> None:
        """Give back one iteration (e.g. for execute_code turns)."""
```

**关键发现**：
- 父+子总和**可超父上限**（避免"一个子代理就吃光父预算"）
- `refund()` 让"非真实推理轮次"（如 `execute_code` 容器执行）不计费
- 预算是**树形而非全局单计数**

**对比 CC + Codex**：CC 用 `taskBudget` 但全局；Codex 似乎也是单 turn 维度。**Hermes 的树形预算是这块最有洞察的设计**——避免子代理饥饿。

**3. 子代理（delegate_task）= 工具触发 + 深度限制**：

```python
# tools/delegate_tool.py:331-405
child = AIAgent(
    ...
    max_iterations=max_iterations,
    iteration_budget=None,  # fresh budget per subagent
)
child._delegate_depth = getattr(parent_agent, '_delegate_depth', 0) + 1
# 禁止递归委派（深度硬限制）
```

**Hermes 的简化**：
- **没有树形命名空间**（vs Codex AgentPath）
- **没有 mailbox**（vs Codex 协作通信）
- **深度硬限制**（保守安全）
- **同步等子代理完成**（不分 async/sync 路径）

更像"打工人临时雇个外援"而非"分布式调度"。**这与 secretary 场景实际可能不匹配**——秘书需要"派给子代理一个长任务，自己继续接消息"。

**4. detached run 概念**：**没有**。

cron 是独立机制（构造**新 AIAgent**，与主循环不通信），**不算**真正的 detached run。

**这与 CC + Codex 一致**：**三个产品都不在 engine 层暴露 detached run 协议**。

**5. SessionDB = SQLite + WAL + FTS5**：

`hermes_state.py` 的会话持久化用 SQLite + 全文检索。**对查 run 状态而言**，这是个比 in-memory Map 更稳的方案：父 / 用户 / 上层 UI 都可以查 sessions 表的 status 字段。

#### 对我们的启发

- ✅ **第三个独立证据**：Hermes 也不在 engine 层暴露 RunHandle，方案 A 已是**业内共识** —— 不再需要更多调研验证
- ✅ **IterationBudget 树形预算 + refund** 是 multi-agent 必备设计，应直接抄
- ✅ **delegate_task 深度限制** 是简单防失控的兜底，linnsec 应该也加
- ⚠️ **同步等子完成不分 async** 与秘书场景不符 —— 我们要用 CC + Codex 的"立即返回 + 注入下一轮"模式
- ⚠️ Hermes 的子代理协议**没有命名空间** —— 不要照抄，应学 Codex AgentPath
- ✅ SessionDB SQLite + FTS5 让上层查 run 状态有持久化兜底 —— `peekRun(conversationId)` helper 可以先查内存再查 SQLite

---

## 4. 候选方案

### 方案 A：纯产品层 wrap，engine **零改动**

**思路**：

- engine 保持现有 sync 形态
- 产品层（linnsec）实现一个 `RunSupervisor` / `TaskCoordinator`：
  - `startDetached(conversationId, request)` → 内部 `spawn` 一个 worker 跑 `FlowOrchestrator.next()`，立即返回 `taskId`
  - 维护 `Map<taskId, {status, conversationId, subscribers, ...}>`
  - 持久化 `Map` 到 JSON 文件
  - run 完成时根据订阅 push 结果（系统注入下一轮 / webhook / SSE）
- 长任务 tool 用 "立即返回 + 后续注入" 模式：tool 立即返回 `{taskId}`，外部进程独立跑 Codex，完成后调 Linnya 入口注入新 turn

**优点**：

- engine 零改动，今天就能干
- 完全契合 OpenClaw 的实际做法（announce 模式）
- 抽包风险最低

**缺点**：

- Linnya 桌面也想用 detached run 时（比如后台跑 deep_research），需要自己再写一遍 wrapper
- 不同消费者的 wrapper 实现可能 diverge，跨产品行为不一致
- "上层查询子 run 状态"在 engine 层没有标准接口，每个产品自己定义

### 方案 B：engine 提供最小 `RunHandle` 协议（**推荐**）

**思路**：

- engine 加一个**最小**接口：

```ts
export interface RunHandle {
  readonly runId: string;
  readonly conversationId: string;
  readonly status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly events: AsyncIterable<RuntimeEvent>;
  cancel(reason?: string): Promise<void>;
  wait(): Promise<RunResult>;
}

export interface RunSupervisorPort {
  start(request: AgentInvocationRequest, opts?: { detached?: boolean }): Promise<RunHandle>;
  get(runId: string): RunHandle | null;
  list(filter?): RunHandle[];
}
```

- engine 默认提供 in-memory 实现（基于现有 GraphExecutor + 一层包装）
- 持久化由宿主注入（`RunRegistryStorePort`）——参考 Checkpointer 的 port 模式
- 现有 `runUntilYield` / `InternalAgentInvoker` 不删除，作为底层 primitive 继续用
- `RunSupervisor` 是建在它们之上的协议层

**优点**：

- 所有消费者一致受益
- 跨产品行为一致（status / events / cancel 语义统一）
- 持久化通过 port 注入，engine 不内嵌存储
- 协议升级路径清晰：先 in-memory，再宿主接持久化

**缺点**：

- engine 多一层抽象（约 1-2 个新文件）
- 需要明确 RunHandle 与现有 `InternalAgentInvoker` 的关系（可能是 `InternalAgentInvoker` 用 RunSupervisor 实现，也可能保持平行）
- 抽包前要加一组测试

### 方案 C：完全 async-first 重设计

**思路**：

- engine 完全围绕 RunHandle 重设计
- `runUntilYield` 退役
- 所有 run 都通过 supervisor 启动
- conversation/run 解耦

**优点**：

- 概念最干净

**缺点**：

- ❌ 重大现有代码改动
- ❌ 风险与收益不成正比
- ❌ 违反"先冻结协议再演进"原则
- 我们这代不应该做这个，留给真有理由时候再说

---

## 5. 当前倾向（**已定稿**，2026-04-21 用户重新拍板）

> **2026-04-21 重大修订**：原"方案 A + 最小 helpers"被用户根据新原则 [`00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md)（"engine 留接口、不做工具、信息丰富"）**否决**，改为 **方案 B：engine 留 RunHandle 协议、信息丰富、不做实现/不做工具**。原方案 A 的"三方独立架构收敛到同一形态"调研结论 100% 仍然成立——只是结论的**应用方式**反过来了：三方都在产品层各自拼凑 TaskRecord（信息散落、各自重复）这一事实，恰恰证明了"engine 应当主动留 RunHandle 协议接口、避免每个产品再造一遍"。

### 5.1 方案选择：**B（engine 留 RunHandle 协议）**

按 [`00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md) "留接口、不做工具" 三层切分：

| 层 | 谁负责 | 本 topic 具体内容 |
|----|-------|----------------|
| **能力层（engine 留）** | linnkit | `RunHandle` 协议 + `peek` / `list` / `cancel` / `wait` / `subscribe` API + `IterationBudget` 树形预算 + `delegate_depth` 硬限制 |
| **实现层（产品层 host adapter）** | linnya / linnsec | `MemoryRunRegistryStore` / `SqliteRunRegistryStore` 等持久化后端 |
| **工具层（产品层应用代码）** | linnya / linnsec | "查进展"工具 / 任务管理 UI / IM 弹按钮 / CLI `agent ps` / `<subagent_notification>` 注入策略 / TaskRecord 跨产品共享类型 |

**判断依据**：父 agent 查询子 agent 状态、上层应用查询任意 run 状态——**这是 capability 层面的能力**，不是产品工具。三个顶级产品都在产品层重新拼装这个能力（CC `AppState.tasks` Map / Codex `ThreadManager` HashMap / Hermes SessionDB），恰好印证 engine 留协议接口能消除重复。

### 5.2 RunHandle 协议（信息丰富设计）

按 audit §1.4 "信息丰富 ≠ 工具丰富" 原则，接口要让上层做工具时**不再 wrap engine** 才算合格。

#### 5.2.1 spawn

```typescript
type SpawnDetachedOpts = {
  request: AgentInvocationRequest;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
  iterationBudget?: { max: number; refundable: boolean };
  delegateDepthLimit?: number;
};

type SpawnDetachedResult = {
  runId: string;
  conversationId: string;
  parentRunId?: string;
  startedAt: number;
};

interface RunSupervisor {
  spawnDetached(opts: SpawnDetachedOpts): Promise<SpawnDetachedResult>;
  // ...
}
```

→ engine 负责"把请求挂上去 + 立即返回 runId"；**不**负责"把 runId 通知给 IM / 写入 SQLite / 渲染 UI"——那是工具层。

#### 5.2.2 peek（信息丰富）

```typescript
type RunStatus =
  | 'pending' | 'running' | 'awaiting_user'
  | 'completed' | 'failed' | 'cancelled';

type PeekRunResult = {
  runId: string;
  conversationId: string;
  parentRunId?: string;
  status: RunStatus;
  currentNode?: 'llm' | 'tool' | 'wait_user' | 'answer' | string;
  startedAt: number;
  updatedAt: number;
  pendingInteractionSpec?: WaitUserSpec;
  recentEvents?: RuntimeEvent[];
  iterationsUsed?: number;
  iterationBudgetRemaining?: number;
  errorIfAny?: { errorCode: string; message: string; recoverable: boolean };
  metadata?: Record<string, unknown>;
};

interface RunSupervisor {
  peek(runId: string, opts?: { recentEventsLimit?: number }): Promise<PeekRunResult | null>;
}
```

→ 上层做"任务卡片"、"老板问进展"、"CLI 表格"全部直接拿这一坨数据；engine 不关心怎么呈现。

#### 5.2.3 list（带过滤）

```typescript
type ListRunsFilter = {
  status?: RunStatus | RunStatus[];
  parentRunId?: string;
  startedAfter?: number;
  startedBefore?: number;
  limit?: number;
  cursor?: string;
};

type RunSummary = Pick<PeekRunResult,
  'runId' | 'conversationId' | 'parentRunId' | 'status' |
  'currentNode' | 'startedAt' | 'updatedAt'>;

interface RunSupervisor {
  list(filter?: ListRunsFilter): Promise<{ runs: RunSummary[]; nextCursor?: string }>;
}
```

→ "我刚才让 Codex 做的事进展怎样了" / "列出所有运行中任务" / "上周失败的任务" 全部用 `list({ ... })`；engine 不关心 IM 怎么排版。

#### 5.2.4 wait + subscribe（两种等待）

```typescript
interface RunSupervisor {
  wait(runId: string, opts?: { timeoutMs?: number }): Promise<PeekRunResult | null>;
  subscribe(runId: string, opts?: { fromEventId?: string }): AsyncIterable<RuntimeEvent>;
}
```

→ wait 适合"父 agent 等子 agent"；subscribe 适合"老板打开任务面板看实时进度"。engine 提供两种语义，上层选。

#### 5.2.5 cancel

```typescript
interface RunSupervisor {
  cancel(runId: string, opts?: {
    reason?: string;
    forceCleanup?: boolean;
  }): Promise<{ ok: boolean; finalStatus: RunStatus }>;
}
```

→ engine 内部：触发 `abortSignal` + 标记 status = `cancelled`；可选 `forceCleanup` 调用 `RunRegistryStore.delete(runId)`。

#### 5.2.6 IterationBudget 树形预算（Hermes 启发，capability 不是工具）

```typescript
type IterationBudgetTree = {
  runId: string;
  max: number;
  used: number;
  refundable: boolean;
  children: IterationBudgetTree[];
};

interface RunSupervisor {
  getBudgetTree(runId: string): Promise<IterationBudgetTree | null>;
  refundBudget(runId: string, amount: number): Promise<void>;
}
```

→ 父预算 + 子预算独立、子总和可超父；长任务工具可 `refund()` 不计费。**capability 留够，调用策略由产品层决定**。

#### 5.2.7 delegate_depth 硬限制

由 `RunSupervisor` 内部检查（不是工具层职责）；超限直接拒绝 spawn：

```typescript
type SpawnDetachedError = {
  code: 'delegate_depth_exceeded';
  current: number;
  limit: number;
  ancestry: string[];
};
```

→ 这是**反失控**机制，必须在 engine 层硬保证（OpenClaw 用提示工程做这事是脆弱的）。

### 5.3 RunRegistryStore 持久化 port

`RunSupervisor` 需要持久化后端，但 engine 不实现具体 backend：

```typescript
interface RunRegistryStore {
  save(record: RunRecord): Promise<void>;
  load(runId: string): Promise<RunRecord | null>;
  list(filter: ListRunsFilter): Promise<{ runs: RunRecord[]; nextCursor?: string }>;
  delete(runId: string): Promise<void>;
}
```

具体实现归 [`engine/06-checkpointer-and-persistence.md`](./06-checkpointer-and-persistence.md) 决议，host 提供：
- linnya 桌面：`MemoryRunRegistryStore` 即可（关闭即失，单进程）
- linnsec：`SqliteRunRegistryStore`（与 SessionDB 共用 SQLite 实例）

### 5.4 不做（明确划界）

| 不做 | 谁做 | 原因 |
|------|------|------|
| `<subagent_notification>` XML 注入策略 | linnya / linnsec 自定义；secretary 提供共享模板 | 工具层 / 产品语义层 |
| TaskRecord 跨产品类型 | secretary 共享包 | 产品层 |
| IM 通知 / 任务面板 UI / CLI 命令 | linnya / linnsec 应用代码 | 工具层 |
| RunRegistryStore 具体后端实现 | linnya / linnsec host adapter | 实现层 |
| Cron / Scheduler | linnsec 产品 | 工具层 + 产品语义 |
| 跨进程 RunHandle 序列化协议 | 等真出现"IDE 客户端跨进程查 run"再加 | YAGNI |

### 5.5 三方调研结论的修正应用

| 原结论（仍然成立） | 修正后应用（按 §1.4 新原则） |
|--------|----------|
| 三方都用产品层 TaskRecord/HashMap/AppState | 这是**重复造轮子的负面证据**——engine 留 RunHandle 协议正好消除重复 |
| 子代理结果走 XML 注入下一轮 | 这是**工具层模式**，不进 engine；secretary 提供共享模板 |
| Hermes 树形 IterationBudget | ✅ engine 留接口（capability） |
| Codex AgentPath 路径 | ✅ engine 在 RunHandle 元数据里支持 `parentRunId` 形成隐式树（不做显式 path 编码——产品层 naming） |
| Hermes session_key 模板 | ❌ 产品语义，归 secretary |

### 5.6 历史归档：原方案 A 内容（仅供回顾）

> 以下内容在 2026-04-21 之前是定稿候选，现已归档。保留此节让后续读者理解决策演化。

**三方独立调研后的最终收敛**：

三个顶级 agent 产品（CC ~数百万用户 / Codex 数十万开发者 / Hermes 多 IM 永驻）**架构风格完全不同**（async generator / channel actor / 同步 while），但**产品形态完全一致**：

| 维度 | Claude Code | Codex CLI | Hermes |
|------|------------|-----------|--------|
| engine 是否暴露 RunHandle | ❌（AppState Map） | ❌（ThreadManager HashMap） | ❌（无概念，cron 独立） |
| 子代理结果传递 | `<task-notification>` XML 注入下一轮 | `<subagent_notification>` XML 注入下一轮 | tool 同步返回（保守） |
| 子代理命名空间 | team 扁平组（邮箱） | `AgentPath` 树形路径 | 无（深度硬限制） |
| 常驻 daemon 默认 async | ✅ KAIROS | ✅ app-server | ✅ Gateway runner |
| 协议层公开接口 | `ResumeFromEventRequest` 等 | `thread/start` `turn/start` JSON-RPC | TUI JSON-RPC + Web REST + IM |
| Detached run 概念 | ❌（AgentTool async 是 in-process） | ❌（cloud-tasks 是产品层） | ❌（cron 是独立机制） |

**结论强度**：**三个独立架构风格 + 三种独立用户群体 + 三种独立产品形态 = 收敛到同一答案**。这不再是"巧合"，而是**正确的分层**。

**最终定稿**：**方案 A + 产品层 Task abstraction + engine 最小增强**

具体来说：

1. **engine 不新增 RunHandle 协议**（彻底排除方案 B/C）
2. **engine 新增最小 helpers**（非协议，只是工具函数）：
   - `spawnDetached(request) → { taskId, conversationId }`：包装 `void FlowOrchestrator.next(...)` + 异常捕获
   - `peekRun(conversationId) → { status, currentNode, pendingInteractionSpec }`：包装 `peekCheckpoint` + 状态语义化
   - 这两个方法**不组合成 Port 协议**
3. **engine 新增 `IterationBudget`-like 树形预算**（Hermes 启发）：
   - 父预算 + 子预算独立，子总和可超父
   - `refund()` 让长任务工具不计费
   - 这是**唯一一处需要 engine 真改动**——但代码量很小（一个 class + 集成点）
4. **host 层 `TaskRecord` 抽象**（在 `secretary/02-gateway-daemon.md` 详细设计）：
   - **CC `Task` 接口**：`{ name, type, kill() }` —— 生命周期 / UI presence
   - **Codex `ThreadStatus`**：`NotLoaded / Idle / SystemError / Active{flags}` —— 状态枚举
   - **Codex `AgentPath`**：hierarchical agents 树形命名（**不学 Hermes 的扁平**）
   - **Hermes session_key 模板**：`agent:main:{platform}:{chat_type}:{chat_id}` —— session-key 命名
   - **Hermes SQLite + FTS5 持久化**：上层 UI 查 run 历史的兜底
5. **子代理结果统一走"XML 注入下一轮"**：
   - 三个产品两个独立证据 + 一个"无概念"——**正向证据足够**
   - 注入标签：`<subagent_notification>`（与 Codex 一致，比 CC 的 task-notification 意图更明确）
   - 注入者是 host，不是 engine
6. **Delegate bridge**（Codex 启发）：
   - 子代理的权限请求**上浮到父/顶层 session**
   - 现有 `InternalAgentInvoker` 演进为 "routed delegation"
   - 独立演进项，不阻塞第一阶段产品开发
7. **`delegate_depth` 硬限制**（Hermes 启发）：
   - 防失控：默认深度 ≤ 3
   - 在子代理工具的 schema 层就拒绝
8. **现有 `InternalAgentInvoker` 保持作为 sync 调用 primitive** 不动

**为什么这个方案稳（增强论证）**：

- **3 种架构风格 + 3 种用户群体收敛到同一产品形态** → 几乎无法被推翻
- engine 改动 = 2 个 helper 函数 + 1 个 IterationBudget class + 集成点 → 第一阶段落地风险极低
- Task abstraction 在 secretary 层设计 → 不污染 engine
- 跨产品借鉴：CC Task + Codex Path/Status + Hermes 树形预算 + Hermes session_key → 合成更清晰的 TaskRecord

**最终定稿**：

- engine 侧：
  - `runtime-kernel/run-helpers/{spawnDetached,peekRun}.ts`（每个 < 100 LoC）
  - `runtime-kernel/iteration-budget/iterationBudget.ts`（约 100-200 LoC）
  - `child-runs/internalAgentInvoker.ts` 集成 IterationBudget + delegate_depth
- secretary 侧：
  - `TaskRecord` 抽象在 `secretary/02-gateway-daemon.md` 详细设计
  - `<subagent_notification>` 协议在 `secretary/02` 或新 topic `engine/09-subagent-notification-protocol` 定义
- Linnya 桌面：复用同一 `TaskRecord` 抽象（通过 shared 包）

**调研已收敛，本 topic 等用户拍板即可进入实施阶段**。

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 用户拍板**：按 §1.4 新原则，全部 7 题以"engine 留接口、信息丰富、不做实现/不做工具"为基线决策。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | 是否在 engine 提供 RunHandle 协议？ | ✅ **B 提供** | 按 §1.4 新原则——是 engine 范畴的 capability，留接口可消除三方产品的重复造轮 |
| Q2 | RunHandle 是否包含事件流订阅？ | ✅ **包含**（提供 `subscribe()` + `wait()` 双语义） | 信息丰富原则——上层做实时面板、IM 持续转发都需要事件流；不提供等于强迫上层 wrap |
| Q3 | `InternalAgentInvoker` 与 RunSupervisor 关系 | ✅ **InternalAgentInvoker 演进为 RunSupervisor 的 sync 调用模式** | sync 子 run = `spawnDetached + wait` 的特化；统一抽象避免两套代码 |
| Q4 | 跨 daemon 重启恢复在本 topic 还是 06？ | ✅ **本 topic 只定义 `RunRegistryStore` port 接口，具体实现归 06** | 接口在使用方定义最自然；持久化策略是 06 的事 |
| Q5 | cancel 语义 | ✅ **触发 abortSignal + 标记 status=cancelled；可选 `forceCleanup` 调 store.delete** | 默认行为可逆（保留记录便于事后审计）；强制清理 opt-in |
| Q6 | detached run 与父 run 的 LLM 上下文关系 | ✅ **engine 层不规定**——由 `AgentInvocationRequest.conversationHistory` 传入；engine 只负责把 history 透传给 context-manager | 这是 invocation 层语义，不是 RunSupervisor 职责；产品层自行决定继承多少 |
| Q7 | 如何防止 LLM 滥用 detached spawn？ | ✅ **engine 硬保证 `delegate_depth` 上限**（默认 ≤ 3），超限直接抛 `delegate_depth_exceeded`；提示工程不算保障 | 反失控必须协议级强制；OpenClaw 的"靠提示禁轮询"是脆弱反例 |

### 6.1 决策的连锁效应

- **Q4 决策** → engine/06 必须在文档里包含 `RunRegistryStore` 接口定义讨论
- **Q3 决策** → engine 实施阶段需要 refactor `InternalAgentInvoker` 让它走 `RunSupervisor.spawnDetached + wait` 路径（不破坏现有 sync 语义）
- **Q6 决策** → conversationId / history 继承策略归 [`engine/02-session-and-tenancy.md`](./02-session-and-tenancy.md) 详述

---

## 7. 落地任务（按方案 B 展开）

### 7.1 Engine 内任务

- [ ] T1：新建 `src/agent/runtime-kernel/run-supervisor/` 模块
  - `runHandle.ts` —— `RunSupervisor` interface + 类型定义（按 §5.2 全套 API）
  - `runRegistryStorePort.ts` —— `RunRegistryStore` 持久化 port 接口
  - `inMemoryRunSupervisor.ts` —— 默认 in-memory 实现（dev / 测试用）
  - `delegateDepthGuard.ts` —— 反失控硬限制
  - `__tests__/runSupervisor.contract.test.ts` —— 协议级 contract 测试（任何 store 实现都要通过）

- [ ] T2：新建 `src/agent/runtime-kernel/iteration-budget/iterationBudget.ts`（树形预算 + refund）+ 单元测试

- [ ] T3：refactor `src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts`
  - 让它走 `RunSupervisor.spawnDetached + wait` 路径
  - 保留现有 sync 语义对外不变（向后兼容）
  - 集成 IterationBudget + delegate_depth

- [ ] T4：把 RunSupervisor / RunRegistryStore / IterationBudget / RunHandle 类型加进 `src/agent/runtime-kernel/index.ts` exports（与 [`07 §7.1 T2`](./07-public-api-and-package-boundary.md) 协调）

- [ ] T5：更新 `src/agent/runtime-kernel/README.md` 加 "run-supervisor" 段落

### 7.2 Host 侧任务（Linnya）

- [ ] T6：linnya 提供 `MemoryRunRegistryStore`（其实就是 inMemoryRunSupervisor 自带的 store；可作为 wrapper 占位）
- [ ] T7：linnya host 装配点注入 `RunSupervisor`（与 03 LlmProviderFactory 装配同位置）
- [ ] T8：现有 `void next(...)` 调用点 → 渐进迁移到 `RunSupervisor.spawnDetached`，回归测试

### 7.3 Linnsec 侧任务（不在 engine 范围，列出供未来参考）

- T9（linnsec 实施时）：`SqliteRunRegistryStore`（与 SessionDB 共用 SQLite）
- T10（linnsec 实施时）：`query_run_status` 工具（IM 端"老板问进展"按钮）
- T11（linnsec 实施时）：任务面板 UI（Web 或 TUI）

### 7.4 文档任务

- [ ] T12：在 `engine/06-checkpointer-and-persistence.md` 撰写时，纳入 `RunRegistryStore` 实现讨论
- [ ] T13：在 `secretary/02-gateway-daemon.md`（未来撰写）中说明 TaskRecord / `<subagent_notification>` 模板复用 RunHandle

---

## 8. 状态


| 项        | 内容                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 创建日期     | 2026-04-20                                                                                                                 |
| 最近更新     | 2026-04-21（按 audit §1.4 新原则重写为方案 B；§5 / §6 / §7 全部定稿）                                                                                          |
| 当前状态     | ✅ 决策定稿，等候实施                                                                              |
| 阻塞       | 无；与 03 / 06 / 07 / 10 协调时序后即可实施                                                                                                       |
| 下一步      | 进入 E1 实施阶段；与 06 Checkpointer 文档撰写并行（06 需承接 RunRegistryStore 接口）                                  |
| 关联 topic | `02-session-and-tenancy` / `04-long-running-tool` / `06-checkpointer-and-persistence` / `secretary/02-gateway-daemon` / `secretary/05-scheduler-subsystem` |
