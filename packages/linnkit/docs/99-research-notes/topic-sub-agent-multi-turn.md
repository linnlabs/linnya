# Topic · 子 agent 多轮父子交互（4 家源码深度对比）

> 调研日期：2026-04-23
> 调研深度：**深**（直接读源码 + 关键 file:line 引用）
> 触发：linnsec `01b-product-scenarios.md` §5.5 拍板时，第一次调研只读了二手笔记，结论与源码不符；主人指出后重新派 4 个 explore subagent 直接读 `<upstream-workspace>/{claude-code-main, codex, hermes-agent, openclaw}/` 源码
> 笔记类型：**主题横向**（不是单项目纵向；与 `claude-code.md` / `codex.md` / `hermes.md` / `openclaw.md` 互补，**以本文为子 agent 主题的权威源**）

---

## 0. 教训：为什么需要这次"二次调研"

第一次调研结论：

- "父子语义往返 2 次，第 3 次升级主人 = 4 家共识"
- "子上下文不进主记忆 = 4 家共识"
- "父子预算分档 = 必须分档"

实际源码事实（详见下文）：

- "父子 2 次往返"——**4 家全无此概念**
- "子上下文不进主记忆"——**过度简化**，4 家实际是三层（轨迹隔离 / 摘要进父 / 反思）
- "父子分档"——**只有 Hermes 这么做**，其他 3 家用线程数/深度/时间

**根因**：第一次的 explore subagent 没读源码，只读了 99-research-notes 的二手笔记 + WebSearch。二手笔记本身就是源码的解读，再用它调研 = 在已知信息上转圈。

**纪律确立**：以后凡是涉及"X 项目实际怎么做"的判断，**必须** subagent 直接读源码 + 报告带 file:line 引用，不能只看笔记/网络。

---

## 1. 调研提纲（8 条 + 1 条产品判断）

每个项目都按这 8 条调研：

1. 子 agent 实现机制（同进程/子进程/远程）
2. 父→子消息格式（prompt / messages[] / serialized history）
3. 子→父回传格式（流式 / 摘要 / 全 transcript）
4. 多轮父子追加（父能否在子运行中再说话）
5. 失败/超时/卡住（预算硬顶 + 维度选什么）
6. 中断/暂停/恢复（checkpoint 实现）
7. 上下文压缩（父→子是否摘要 / 子→父是否压缩）
8. 子上下文是否进父记忆

第 9 条是**产品判断**：

> **"4 家都没"父→子多轮交互机制时，是产品 bug 还是产品设计**？这是 Linnsy 拍板「2 次往返」时必须正视的问题。

---

## 2. 各项目源码事实

### 2.1 Claude Code（Anthropic CLI）

**仓库**：`<upstream-workspace>/claude-code-main/`（TypeScript，主代码在 `src/`）

#### 2.1.1 子 agent 实现机制

同进程异步生成器 + `query` 循环。`runAgent` 在子 agent 中调用 `query()` 跑完整 agent 推理循环，**不启动独立 OS 进程**。

关键差异：sync 子 agent **共享父的 `AbortController`**，async 子 agent **持有新的独立 `AbortController`**。

```typescript
// src/tools/AgentTool/runAgent.ts:520-528
// Determine abortController:
// - Override takes precedence
// - Async agents get a new unlinked controller (runs independently)
// - Sync agents share parent's controller
const agentAbortController = override?.abortController
  ? override.abortController
  : isAsync
    ? new AbortController()
    : toolUseContext.abortController
```

另有 `RemoteAgentTask`（如 `ultraplan` 用 `task-notification`）作为远程子 agent 旁路。

#### 2.1.2 父→子消息

**常规路径**（指定 `subagent_type` 等）：仅传 `prompt` 字符串作为单条 user message：

```typescript
// src/tools/AgentTool/AgentTool.tsx:538-540
promptMessages = [createUserMessage({
  content: prompt
})];
```

**Fork 路径**（省略 `subagent_type` 等条件）：传父全量 messages：

```typescript
// src/tools/AgentTool/AgentTool.tsx:628-631
// Pass parent conversation when the fork-subagent path needs full context.
forkContextMessages: isForkPath ? toolUseContext.messages : undefined,
```

#### 2.1.3 子→父回传

**Sync 路径** `finalizeAgentTool` 提取最后一条 assistant 的 text 块 + 元数据，**不是全 transcript**：

```typescript
// src/tools/AgentTool/agentToolUtils.ts:276-356
const lastAssistantMessage = getLastAssistantMessage(agentMessages)
let content = lastAssistantMessage.message.content.filter(
  _ => _.type === 'text',
)
return {
  agentId,
  agentType,
  content,
  totalDurationMs: Date.now() - startTime,
  totalTokens,
  totalToolUseCount,
  usage: lastAssistantMessage.message.usage,
}
```

**Async 路径** 通过队列 + attachment 注入下一轮：

```typescript
// src/tasks/LocalAgentTask/LocalAgentTask.tsx:252-261
const message = `<${TASK_NOTIFICATION_TAG}>...`;
enqueuePendingNotification({
  value: message,
  mode: 'task-notification'
});
```

```typescript
// src/utils/attachments.ts:1044-1081
const INLINE_NOTIFICATION_MODES = new Set(['prompt', 'task-notification'])
// 把 task-notification 与 prompt 转为 queued_command attachment
```

#### 2.1.4 多轮父子

`SendMessageTool` 对 running 子 agent 走 `queuePendingMessage`：

```typescript
// src/tools/SendMessageTool/SendMessageTool.ts:800-819
if (isLocalAgentTask(task) && !isMainSessionTask(task)) {
  if (task.status === 'running') {
    queuePendingMessage(agentId, input.message, ...);
    return { ... message: `Message queued for delivery to ${input.to} at its next tool round.` };
  }
}
```

**没有"试 N 次失败就升级到主人"机制**。父中途追加只是排队，子下一轮 tool round 自己决定是否处理。

#### 2.1.5 预算硬顶

- `general-purpose` **无默认 `maxTurns`**：

```typescript
// src/tools/AgentTool/built-in/generalPurposeAgent.ts:25-34
export const GENERAL_PURPOSE_AGENT: BuiltInAgentDefinition = {
  agentType: 'general-purpose',
  // 没有 maxTurns 字段
  getSystemPrompt: getGeneralPurposeSystemPrompt,
}
```

- FORK 路径硬编码 `maxTurns: 200`：

```typescript
// src/tools/AgentTool/forkSubagent.ts:60-71
export const FORK_AGENT = {
  agentType: FORK_SUBAGENT_TYPE,
  maxTurns: 200,
  model: 'inherit',
  permissionMode: 'bubble',
} satisfies BuiltInAgentDefinition
```

- `taskBudget` 在 `runAgent` 默认调用链**未传入**（`src/services/api/claude.ts:479-500`）

#### 2.1.6 子上下文是否进父记忆

`saveCacheSafeParams` / `extract_memories` / `auto_dream` 都 gated 到 `!toolUseContext.agentId`，子 agent 不影响主会话长记忆：

```typescript
// src/query/stopHooks.ts:92-98
// Only save params for main session queries — subagents must not overwrite.
if (querySource === 'repl_main_thread' || querySource === 'sdk') {
  saveCacheSafeParams(createCacheSafeParams(stopHookContext))
}
```

```typescript
// src/query/stopHooks.ts:141-156
if (
  feature('EXTRACT_MEMORIES') &&
  !toolUseContext.agentId &&
  isExtractModeActive()
) {
  void extractMemoriesModule!.executeExtractMemories(...)
}
if (!toolUseContext.agentId) {
  void executeAutoDream(...)
}
```

子侧链 `recordSidechainTranscript` 与主 JSONL 是不同管道。

---

### 2.2 Codex（OpenAI CLI）

**仓库**：`<upstream-workspace>/codex/`（核心是 `codex-rs/`，Rust）

#### 2.2.1 子 agent 实现机制

同进程多 Thread。`ThreadManager::spawn_thread_with_source` → `Codex::spawn` 创建新 `Codex` 会话，插入 `threads` HashMap：

```rust
// codex-rs/core/src/thread_manager.rs:907-997
pub(crate) async fn spawn_thread_with_source(...) -> CodexResult<NewThread> {
    let CodexSpawnOk { codex, thread_id, .. } = Codex::spawn(CodexSpawnArgs {
        config,
        auth_manager,
        conversation_history: initial_history,
        session_source,
        agent_control,
        ...
    }).await?;
    self.finalize_thread_spawn(codex, thread_id, watch_registration).await
}
```

`AgentControl::spawn_agent_internal` 在预留 `agent_max_threads` 槽位后 spawn：

```rust
// codex-rs/core/src/agent/control.rs:190-315
let mut reservation = self.state.reserve_spawn_slot(config.agent_max_threads)?;
// fork or new thread
self.send_input(new_thread.thread_id, initial_operation).await?;
```

#### 2.2.2 父→子消息

`spawn_agent` 工具入参 struct（带 `serde`）：

```rust
// codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:229-277
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SpawnAgentArgs {
    message: String,
    task_name: String,
    agent_type: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
    fork_turns: Option<String>,
    fork_context: Option<bool>,
}
```

实际发送到子线程的 `InterAgentCommunication.content` 是 **`String`**：

```rust
// codex-rs/protocol/src/protocol.rs:717-725
pub struct InterAgentCommunication {
    pub author: AgentPath,
    pub recipient: AgentPath,
    #[serde(default)]
    pub other_recipients: Vec<AgentPath>,
    pub content: String,
    pub trigger_turn: bool,
}
```

`fork_turns` 可选 `none`/`all`/N，决定从父 rollout 截断多少作为子 `InitialHistory::Forked`。

#### 2.2.3 子→父回传

`wait_agent` **仅返回 "Wait completed."/"Wait timed out."**，不流式消费子 transcript：

```rust
// codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:40-127
let mut mailbox_seq_rx = session.subscribe_mailbox_seq();
let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
let timed_out = !wait_for_mailbox_change(&mut mailbox_seq_rx, deadline).await;
let result = WaitAgentResult::from_timed_out(timed_out);
```

默认 30s / 最大 1h：

```rust
// codex-rs/core/src/tools/handlers/multi_agents_common.rs:29-31
pub(crate) const MIN_WAIT_TIMEOUT_MS: i64 = 10_000;
pub(crate) const DEFAULT_WAIT_TIMEOUT_MS: i64 = 30_000;
pub(crate) const MAX_WAIT_TIMEOUT_MS: i64 = 3600 * 1000;
```

`<subagent_notification>` 是 JSON 包 XML：

```rust
// codex-rs/core/src/session_prefix.rs:8-18
pub(crate) fn format_subagent_notification_message(
    agent_reference: &str,
    status: &AgentStatus,
) -> String {
    let payload_json = serde_json::json!({
        "agent_path": agent_reference,
        "status": status,
    }).to_string();
    SUBAGENT_NOTIFICATION_FRAGMENT.wrap(payload_json)
}
```

#### 2.2.4 多轮父子

V1 `send_input` + V2 `send_message` (QueueOnly) / `followup_task` (TriggerTurn)：

```rust
// codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs:23-29
handle_message_string_tool(
    invocation,
    MessageDeliveryMode::QueueOnly,
    args.target,
    args.message,
    /*interrupt*/ false,
)
```

```rust
// codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs:106-113
if interrupt {
    session.services.agent_control.interrupt_agent(receiver_thread_id).await
}
```

**也没有"试 N 次失败升级"机制**。

#### 2.2.5 预算硬顶（**关键**）

**全仓 grep `max_iterations` / `iteration_budget` 零匹配**——之前调研笔记说 Codex 有这两个字段是错的。

实际是：

```rust
// codex-rs/core/src/config/mod.rs:127-128
pub(crate) const DEFAULT_AGENT_MAX_THREADS: Option<usize> = Some(6);
pub(crate) const DEFAULT_AGENT_MAX_DEPTH: i32 = 1;
```

**Codex 的预算维度 = 并发线程数（6）+ spawn 树深度（1）+ wait 超时**。**没有"轮数预算"概念**。

#### 2.2.6 子上下文是否进父记忆

子线程不跑 memory startup pipeline：

```rust
// codex-rs/core/src/memories/start.rs:10-24
/// The pipeline is skipped for ephemeral sessions, disabled feature flags, and
/// subagent sessions.
if config.ephemeral
    || !config.features.enabled(Feature::MemoryTool)
    || matches!(source, SessionSource::SubAgent(_))
{
    return;
}
```

**但**父侧 memory stage-1 **刻意保留** `<subagent_notification>`（与"完全不进"不一致）：

```rust
// codex-rs/core/src/contextual_user_message.rs:50-62
/// We exclude injected `AGENTS.md` instructions and skill payloads because
/// they are prompt scaffolding rather than conversation content, so they do
/// not improve the resulting memory. We keep environment context and
/// subagent notifications because they can carry useful execution context or
/// subtask outcomes that should remain visible to memory generation.
pub(crate) fn is_memory_excluded_contextual_user_fragment(content_item: &ContentItem) -> bool {
    let ContentItem::InputText { text } = content_item else {
        return false;
    };
    AGENTS_MD_FRAGMENT.matches_text(text) || SKILL_FRAGMENT.matches_text(text)
}
```

---

### 2.3 Hermes Agent（NousResearch）

**仓库**：`<upstream-workspace>/hermes-agent/`（Python，顶层 `agent/`/`tools/`/`cron/` 等）

#### 2.3.1 子 agent 实现机制

同进程构造 `AIAgent`，单任务直接调 `_run_single_child`，多任务用 `ThreadPoolExecutor`：

```python
# tools/delegate_tool.py:1-17
"""
Delegate Tool -- Subagent Architecture

Spawns child AIAgent instances with isolated context, restricted toolsets,
and their own terminal sessions. Supports single-task and batch (parallel)
modes. The parent blocks until all children complete.
...
"""
```

#### 2.3.2 父→子消息

工具 schema 是 OpenAI function 风格字典；**子从零上下文启动**：

```python
# tools/delegate_tool.py:1088-1105
"properties": {
    "goal": {
        "type": "string",
        "description": (
            "What the subagent should accomplish. Be specific and "
            "self-contained -- the subagent knows nothing about your "
            "conversation history."
        ),
    },
    "context": {
        "type": "string",
        "description": (
            "Background information the subagent needs: file paths, "
            "error messages, project structure, constraints. The more "
            "specific you are, the better the subagent performs."
        ),
    },
```

子实例部分继承父运行时配置（`session_db` / `parent_session_id` / `prefill_messages` 等），但**强制 `skip_context_files=True` + `skip_memory=True`**：

```python
# tools/delegate_tool.py:376-405
child = AIAgent(
    base_url=effective_base_url,
    api_key=effective_api_key,
    model=effective_model,
    max_iterations=max_iterations,
    quiet_mode=True,
    ephemeral_system_prompt=child_prompt,
    log_prefix=f"[subagent-{task_index}]",
    skip_context_files=True,
    skip_memory=True,
    clarify_callback=None,
    thinking_callback=child_thinking_cb,
    session_db=getattr(parent_agent, '_session_db', None),
    parent_session_id=getattr(parent_agent, 'session_id', None),
    iteration_budget=None,  # fresh budget per subagent
)
```

#### 2.3.3 子→父回传

`delegate_task` 返回 `json.dumps({results, total_duration_seconds})`，每个子任务一条结构化 dict：

```python
# tools/delegate_tool.py:583-610
entry: Dict[str, Any] = {
    "task_index": task_index,
    "status": status,
    "summary": summary,
    "api_calls": api_calls,
    "duration_seconds": duration,
    "model": _model if isinstance(_model, str) else None,
    "exit_reason": exit_reason,
    "tokens": {
        "input": _input_tokens if isinstance(_input_tokens, (int, float)) else 0,
        "output": _output_tokens if isinstance(_output_tokens, (int, float)) else 0,
    },
    "tool_trace": tool_trace,
}
```

#### 2.3.4 多轮父子

**父在 `delegate_task` 期间阻塞**——没有"运行中追加"机制。要再做就**重新调一次 `delegate_task`**（新子实例）。

`steer()` 仅向**下一轮 tool 结果**注入文本（用于父自身循环，不是父→子追加）：

```python
# run_agent.py:3642-3649
"""
Inject a user message into the next tool result without interrupting.

Unlike interrupt(), this does NOT stop the current tool call. The
text is stashed and the agent loop appends it to the LAST tool
result's content once the current tool batch finishes. The model
sees the steer as part of the tool output on its next iteration.
"""
```

#### 2.3.5 预算硬顶

**Hermes 是 4 家中唯一明确做"父子分档"的**：

```python
# tools/delegate_tool.py:80
DEFAULT_MAX_ITERATIONS = 50
```

```python
# run_agent.py:782
max_iterations: int = 90,  # Default tool-calling iterations (shared with subagents)
```

```python
# run_agent.py:188-229
class IterationBudget:
    """Thread-safe iteration counter for an agent."""
    def consume(self) -> bool:
        with self._lock:
            if self._used >= self.max_total:
                return False
            self._used += 1
            return True
```

注意：`run_agent.py` 注释说"shared with subagents"与 `delegate_tool.py` 实际给子 `iteration_budget=None`（fresh budget）不一致——以代码为准，子 agent 实际是新预算。

#### 2.3.6 子上下文是否进父记忆

子 `skip_memory=True` —— 子轨迹不跑父 memory pipeline。

**但**父在子结束后会 `on_delegation(task, result)` 把摘要推给 memory provider：

```python
# tools/delegate_tool.py:892-903
if parent_agent and hasattr(parent_agent, '_memory_manager') and parent_agent._memory_manager:
    for entry in results:
        try:
            _task_goal = task_list[entry["task_index"]]["goal"] if entry["task_index"] < len(task_list) else ""
            parent_agent._memory_manager.on_delegation(
                task=_task_goal,
                result=entry.get("summary", "") or "",
                child_session_id=getattr(children[entry["task_index"]][2], "session_id", "") if entry["task_index"] < len(children) else "",
            )
```

cron 也 `skip_memory=True`：

```python
# cron/scheduler.py:882-884
skip_context_files=True,  # Don't inject SOUL.md/AGENTS.md from scheduler cwd
skip_memory=True,  # Cron system prompts would corrupt user representations
```

---

### 2.4 OpenClaw

**仓库**：`<upstream-workspace>/openclaw/`（TypeScript）

#### 2.4.1 子 agent 实现机制

`runtime: "subagent"` 走 `spawnSubagentDirect` → `callGateway({method: "agent"})`，sessionKey 形如 `agent:${targetAgentId}:subagent:${uuid}`：

```typescript
// src/agents/subagent-spawn.ts:736-762
const response = await callSubagentGateway({
  method: "agent",
  params: {
    message: childTaskMessage,
    sessionKey: childSessionKey,
    ...
    extraSystemPrompt: childSystemPrompt,
    timeout: runTimeoutSeconds,
```

`runtime: "acp"` 走 `spawnAcpDirect`（外部进程/协议）：

```typescript
// src/agents/acp-spawn.ts:1022-1085
const sessionKey = `agent:${targetAgentId}:acp:${crypto.randomUUID()}`;
const initializedSession = await initializeAcpSpawnRuntime({
  cfg,
  sessionKey,
  targetAgentId,
  runtimeMode,
  resumeSessionId: params.resumeSessionId,
  cwd: runtimeCwd,
});
```

#### 2.4.2 父→子消息

Schema 是 `task: string`：

```typescript
// src/agents/tools/sessions-spawn-tool.ts:96-145
const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  ...
  runtime: optionalStringEnum(SESSIONS_SPAWN_RUNTIMES),
  ...
  cwd: Type.Optional(Type.String()),
});
```

实现里拼成 `childTaskMessage`：

```typescript
// src/agents/subagent-spawn.ts:679-687
const childTaskMessage = [
  `[Subagent Context] You are running as a subagent (depth ${childDepth}/${maxSpawnDepth}). ...`,
  ...
  `[Subagent Task]: ${task}`,
].filter((line): line is string => Boolean(line)).join("\n\n");
```

#### 2.4.3 子→父回传

`runSubagentAnnounceFlow` 构造 `internalEvents` + `triggerMessage`，经 `deliverSubagentAnnouncement`：

```typescript
// src/agents/subagent-announce-delivery.ts:284-304
await subagentAnnounceDeliveryDeps.callGateway({
  method: "agent",
  params: {
    sessionKey: item.sessionKey,
    message: item.prompt,
    channel: requesterIsSubagent ? undefined : origin?.channel,
    deliver: !requesterIsSubagent,
    internalEvents: item.internalEvents,
    inputProvenance: {
      kind: "inter_session",
      sourceSessionKey: item.sourceSessionKey,
      sourceChannel: item.sourceChannel ?? INTERNAL_MESSAGE_CHANNEL,
      sourceTool: item.sourceTool ?? "subagent_announce",
    },
```

嵌套子 agent 的 announce 走 `requesterIsSubagent` 分支（`deliver: false`，仅给编排会话注入）。

#### 2.4.4 多轮父子

RPC 名是 `sessions.steer`（**点号，非下划线**），共用 `handleSessionSend` 但 `interruptIfActive: true`：

```typescript
// src/gateway/server-methods/sessions.ts:1210-1220
"sessions.steer": async ({ req, params, respond, context, client, isWebchatConnect }) => {
  await handleSessionSend({
    method: "sessions.steer",
    ...
    interruptIfActive: true,
  });
},
```

`agent.wait` 按 `runId` 等待生命周期（`src/gateway/server-methods/agent.ts:1021-1099`）。

#### 2.4.5 预算硬顶

`runTimeoutSeconds`（`subagent-spawn.ts`）+ `announceTimeoutMs`（默认 120s）+ `maxSpawnDepth` + `maxChildrenPerAgent`。

**`maxTurns` 在 subagent 链上未实锤**——schema 里有但 subagent 路径未确认接线。

#### 2.4.6 子上下文是否进父记忆

`MEMORY.md` 等被 `filterBootstrapFilesForSession` 裁掉：

```typescript
// src/agents/workspace.ts:573-581
export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}
```

transcript 按 sessionKey 分文件（子会话不并入主 session jsonl）。**但 workspace 目录可能与主会话共用**。

---

## 3. 横向对比表

| # | 维度 | CC | Codex | Hermes | OpenClaw | Linnsy 启示 |
|---|------|----|----|----|----|----|
| 1 | 子实现 | 同进程 `runAgent` + `query` | 同进程多 Thread | 同进程 `AIAgent` + ThreadPool | 同进程 `spawnSubagentDirect`（+ 可选 ACP 外部） | ✅ 4 家共识：**同进程**，linnkit `ChildRunInvoker` 已是这套 |
| 2 | 父→子消息 | 默认 prompt 字符串；fork 路径传 `messages[]` | `String` content；可配 `fork_turns` | `goal + context` 字符串，"子从零启动" | `task: string`（拼成 `childTaskMessage`） | ✅ 默认不传父全量历史，但 CC/Codex 都有 fork 选项 |
| 3 | 子→父回传 | sync: 最后 assistant text；async: XML 通知 | "Wait completed" + JSON 包 XML | `json.dumps` 摘要 dict | `triggerMessage + internalEvents` | ✅ 4 家共识：**结构化摘要**，不灌全 transcript |
| 4 | 父→子追加 | `SendMessage` 排队 | `send_input` / `send_message` QueueOnly | **不能**——`delegate_task` 阻塞，要再做就重派 | `sessions.steer` 可中断+引导 | ⚠️ **4 家无"试 N 次升级"机制**，详见 §4 |
| 5 | 预算硬顶维度 | `general-purpose` 无默认 maxTurns；FORK 200 | **无 iteration 字段**！只有 `agent_max_threads=6 + max_depth=1 + wait_timeout` | **父 90 / 子 50** + IterationBudget | `runTimeoutSeconds + maxSpawnDepth + maxChildrenPerAgent` | 各家分歧大，建议**多维度组合** |
| 6 | 中断/恢复 | `recordSidechainTranscript` + `resumeAgentBackground` | rollout JSONL + `resume_thread_from_rollout` | 子被中断后丢弃，无 checkpoint | `subagent-registry` 落 `runs.json` | linnkit `Checkpointer` 已覆盖 |
| 7 | 上下文压缩 | `AUTOCOMPACT_BUFFER_TOKENS = 13_000`，子自己 compact | `Op::Compact` + `ContextManager`，跨 Thread 不自动摘要 | `ContextCompressor.compress`，父→子无摘要传递 | `lightContext` + bootstrap 过滤 | 父→子都不做"压缩传递"，子从零启动 |
| 8 | 子→父记忆 | `extract_memories` + `auto_dream` gated `!agentId` | 子不跑 memory pipeline；**但父记忆刻意保留 `<subagent_notification>`** | 子 `skip_memory=True`；**但 `on_delegation` 把摘要推给 provider** | `MEMORY.md` 等被 bootstrap 过滤掉 | **三层模型**（轨迹隔离 / 摘要进父 / 反思进长记忆） |

---

## 4. 关键产品判断："4 家无父子多轮升级"意味着什么

这是**比单点源码事实更重要的产品级洞察**。

### 4.1 事实

4 家全部没有"父→子追问 N 次失败就自动升级到主人"机制：

- **CC**：`SendMessage` 只是排队让子下一轮看
- **Codex**：`send_input/send_message` 也只是排队
- **Hermes**：父根本不能在子运行中追问，只能"重新派一个"
- **OpenClaw**：`steer` 是引导不是追问

### 4.2 为什么？三种可能解释

**解释 A：「子 agent 一次搞定」是常见场景**

- 给清晰任务规约 + 完整上下文，子 agent 直接交付
- "需要追问"是任务规约不清的症状，应该在前置规约时解决，不是事后多轮补救
- 4 家都不做是因为**真不需要**

**解释 B：4 家都有"主用户在场"假设**

- CC/Codex 是 IDE 编程助手——主用户在场，子失败用户直接介入
- Hermes 也主要是单机交互模式
- OpenClaw 虽 24/7 但子 agent 偏小并发执行单元
- 它们都不需要"自动升级"是因为**用户随时能接管**

**解释 C：父 LLM 评估子结果不可靠**

- "父→子第二轮"的前提是"父能判断子第一轮结果好不好"
- 这是 LLM-as-judge 问题，准确率不高
- Hermes 的设计哲学（"再调一次 delegate"）暗示：**重新规约任务再派 > 追问旧子**

### 4.3 对 Linnsy 的影响

Linnsy 的场景与 4 家**部分相同部分不同**：

| 维度 | 4 家 | Linnsy |
|------|------|--------|
| 主用户在场？ | ✅ 大多在场 | ❌ **异步 IM，多数时候不在场** |
| 子 agent 自主长跑？ | 🟡 部分 | ✅ 必须 |
| 主要场景？ | 编程/单次任务 | 24/7 多任务调度 |

→ **Linnsy 确实需要"子失败时升级"机制**（因为主人不在场），但 **"父子轮 2 次"这个数字没源码依据**。

### 4.4 三种修订方案（待主人拍板）

**方案 A：取消"2 次往返"，改为"一次性派遣 + 失败重派 + N 次重派后升级"**

- 子 agent 默认 fire-and-forget（学 4 家共识）
- 子完成后父评估摘要：满意 → 推进；不满意 → **重新派一个新子**（带改进的任务规约）
- "父对子追问"概念**整个删掉**——不存在父子轮次
- 重派 N 次（默认 1 次重派 = 总共 2 次派遣）失败 → 升级主人
- **优点**：与 4 家源码事实对齐；"重新规约重派"比"追问"更可控；Hermes 实证有效
- **缺点**：无法利用子 agent 已有的中间状态（每次重派都从零开始）

**方案 B：保留"2 次往返"作为产品决策但放到 Phase 2**

- Phase 1：方案 A（fire-and-forget + 重派）
- Phase 2：评估 CC `SendMessage` / Codex `send_input` 的 ROI，再决定是否引入"中途追加"
- **优点**：Phase 1 简单；保留长期演化空间
- **缺点**：Phase 2 决策推迟到有数据再做

**方案 C：保留"2 次往返"但承认是 Linnsy 自创**

- 明确"4 家无此概念"作为产品决策依据（异步秘书场景的特殊需求）
- "2 次"是猜的数字，需要在 alpha 阶段调
- **优点**：保留原拍板的产品意图
- **缺点**：缺少同类项目验证；可能是过度设计

**笔记作者倾向**：**方案 A**——理由是：

1. 4 家共识"父→子追问"几乎无价值，都改成"重派"或"排队下一轮"
2. Hermes 明确选择"再调一次 delegate"路线，且产品成熟
3. "重新规约重派"语义更清晰，符合 LLM 思维方式
4. 第 4 层 LLM-as-judge 问题（"父能否判断子结果好坏"）在"重派"场景下转化为"父能否改进任务规约"——后者更稳定

### 4.5 最终拍板（2026-04-23 主人选 **方案 B**）

**Phase 1**：走方案 A 实现（fire-and-forget + 失败改进规约重派 + 重派 1 次仍不行升级主人，即总共最多 2 次派遣）；**取消"父子轮次"概念**。

**Phase 2**：评估"中途追加"是否引入——参考 CC `SendMessage` / Codex `send_input` 的 `queuePendingMessage` + 子下一轮 attachments 排空设计；触发条件：alpha 阶段如观察到"重派 N 次都不行 + 主人介入后只补一句话就解决"占比 >30%，说明"中途追加"有 ROI。

→ 拍板正式落档：[`linnsy/01b-product-scenarios.md`](../../../../linnsy/01b-product-scenarios.md) §5.5 拍板 #5。

**为什么选 B 不选 A**：B = "Phase 1 走 A 实现 + Phase 2 留口"，比 A 多了"alpha 数据驱动决策"的退路——避免 Phase 1 拍死后发现"重派 + 升级"不够用时无路可走。Linnsy 是新产品，重要决策都该留这种数据演化口。

---

## 5. 对 Linnsy §5.5 决策的影响（已落档）

详见 [`linnsy/01b-product-scenarios.md`](../../../../linnsy/01b-product-scenarios.md) §5.5「2026-04-23 拍板，2026-04-23 源码深度调研后修订」段。

修订后的 6 条 Phase 1 拍板：

1. ✅ 同进程 + 独立上下文/工具/预算（4 家共识，源码验证）
2. ✅ 默认不传父全量历史（4 家默认行为，fork 模式 Phase 2 评估）
3. ✅ 子→父结构化摘要（4 家共识）
4. 🔄 预算硬顶**多维度组合**（推翻"父子分档"为唯一维度）
5. ✅ **fire-and-forget + 失败重派 + 重派 1 次仍不行升级主人**（2026-04-23 主人拍板方案 B；详见 §4.4 / §4.5）—— **取消"父子轮次"概念**，改为"派遣次数"语义
6. 🔄 子上下文与主记忆**三层模型**（推翻"完全不进"绝对说法）

---

## 6. 后续深挖待办

- 若主人拍板方案 A："失败重派"的"任务规约改进"逻辑设计（让 LLM 自己改 / 模板 / 主人参与？）
- Codex `fork_turns` 的具体使用场景（什么时候真要传父历史？）
- CC `RemoteAgentTask` 与 in-process `runAgent` 的边界（远程子 agent 的产品场景）
- Hermes `IterationBudget` 与 `delegate_tool.py` `iteration_budget=None` 的不一致——是注释陈旧还是设计变更
- OpenClaw `subagent-registry` 的 `archiveAtMs` 在父子升级场景的应用

---

## 附 · 调研方法学反思

**这次的失败案例**：第一次 explore subagent 只读 `99-research-notes/{project}.md` + WebSearch，没碰源码——产出的"4 家共识"结论实际上是**笔记作者的解读**，不是源码事实。

**纪律**：
1. **任何"X 项目实际怎么做"的判断必须 file:line 引用源码**
2. **二手笔记只能作为索引/起点**——可以告诉你"哪些模块要看"，不能直接当结论
3. **subagent 派发时必须明确禁止"只读笔记"**，并给出仓库本地路径 + 关键 grep 词
4. **产出的报告必须区分"源码支持/源码推翻/源码未覆盖"**三态，不能模糊
