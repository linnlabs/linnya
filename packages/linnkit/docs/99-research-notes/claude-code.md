# Claude Code

> 调研日期：2026-04-20  
> 调研深度：深（4 个 explore subagent 并行覆盖 ~512K LOC，路径 + 关键代码片段 + 模式提取）  
> 质量评估：⭐ 工程质量极高（Anthropic 官方），同时有部分 CLI/产品强绑定的耦合代码  
> 借鉴边界：⭐ **可学习架构**；部分模块 ⭐⭐ **可学习实现细节**（如权限状态机、Dream prompt、tool 抽象）；少数 ⚠️ **不要照抄**（feature flag 矩阵、终端 UI 与 AppState 深耦合、Anthropic OAuth 强绑定）

仓库位置（本机）：`<upstream-workspace>/claude-code-main/`
源来源：2026-03-31 npm source-map 暴露事件后的 snapshot（教育/安全研究归档）。

---

## 0. 顶层判断（必读）

Claude Code 在我们关心的几乎所有维度上都给出了**已经被生产验证**的答案。**它不是图执行引擎**，而是单文件 `query.ts` 里的 `async generator + while(true)` 循环 + 注入式 `deps.callModel`。**复杂度集中在协议、提示词、状态机、文件契约**，而非"算法巧思"。这条路线对我们最有启发的是：**协议先行、提示词承担大量编排、磁盘文件作为 SSOT**。

---

## 1. 项目定位

- **形态**：桌面 CLI（Bun + TypeScript + React/Ink 终端 UI）；可选 daemon / bridge / remote 模式
- **运行单位**：默认每个会话一个 CLI 进程；可启用 `claude daemon`（supervisor + worker subprocess）
- **服务面向**：单用户开发者；通过 OAuth 与 Anthropic 云端 CCR 协同
- **可扩展性**：MCP server / Skill / Plugin / Hook 四层
- **完全开放给 LLM 控制**：超过 30 种工具，包含 cron、sleep、worktree、agent spawn、send-message、team 管理等

---

## 2. 顶层目录与代码组织

### 2.1 主分层


| 路径                                   | 角色                                                                 | 字符特征                                         |
| ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------- |
| `src/main.tsx`                       | CLI 主入口（Commander.js + Ink renderer）                               | 顶部并行预取 MDM/keychain/GrowthBook               |
| `src/entrypoints/cli.tsx`            | 早期入口分叉（version/daemon/bridge/bg/templates）                         | 按 feature flag fast-path                     |
| `src/QueryEngine.ts` (~46K LOC)      | LLM 查询引擎，会话级状态持有者                                                  | 单类承载 turn lifecycle                          |
| `src/query.ts` / `src/query/`        | **核心 agent loop**（async generator）                                 | `while(true)` + 注入 `deps.callModel`          |
| `src/Tool.ts` (~29K LOC)             | **统一 Tool 类型**                                                     | 巨型类型，承载 call/permission/UI/API               |
| `src/tools.ts` + `src/tools/`        | 30+ 工具实现                                                           | 静态注册 + 动态 MCP                                |
| `src/Task.ts` + `src/tasks/`         | **后台任务抽象**（与 query 正交）                                             | UI presence + lifecycle (kill) + disk output |
| `src/services/`*                     | API/MCP/OAuth/LSP/analytics/compact/extractMemories/teamMemorySync | 各服务一文件夹                                      |
| `src/memdir/`                        | **记忆系统**（文件 + frontmatter + side query）                            | 无向量，全文件式                                     |
| `src/coordinator/coordinatorMode.ts` | 协调模式（仅一个文件）                                                        | env + system prompt 而已                       |
| `src/remote/`                        | 云端 CCR 会话客户端（WS subscribe + HTTP send）                             | 不是 P2P                                       |
| `src/bridge/`                        | IDE / remote-control 桥（注册 worker → 拉 work → spawn 子进程）             | 复杂，独立控制面                                     |
| `src/server/`                        | direct-connect 客户端（HTTP 建会话 + WS 订阅）                               | server 实现不在快照里                               |
| `src/skills/`                        | Skill 系统（bundled TS-inlined Markdown + 用户/项目目录）                    | Skill ≠ Tool ≠ MCP                           |
| `src/plugins/`                       | 插件加载器（manifest + 命令/agent/skill/hook/MCP 注入）                       | 内置插件本快照为空                                    |
| `src/hooks/toolPermission/`          | 工具权限交互/桥接处理器                                                       | claim() 防双 resolve                           |
| `src/voice/`                         | Voice 模式开关（push-to-talk WS + OAuth-only）                           | 仅是输入模态                                       |


### 2.2 Feature flag 矩阵（值得知道，不必照搬）

通过 `bun:bundle` 的 `feature()` 在 build 时做 dead code elimination：

- `DAEMON` —— 启用 daemon 子命令与 worker fast-path
- `BRIDGE_MODE` —— 启用 IDE/remote-control 桥
- `VOICE_MODE` —— 启用 voice 模块
- `PROACTIVE` / `KAIROS` —— **主动模式**（agent 自驱动循环）
- `AGENT_TRIGGERS` —— 启用 cron 工具
- `MONITOR_TOOL` —— 监控工具
- `EXTRACT_MEMORIES` —— 启用自动 memory 提取
- `FORK_SUBAGENT` —— 强制 sub-agent 异步派生
- `TRANSCRIPT_CLASSIFIER` —— 启用 `auto` 权限模式

---

## 3. 核心架构主线

### 3.1 Agent 主循环（**没有图引擎**）

`src/query.ts` 的 `queryLoop()` 是 `**while(true)` + async generator**，状态用可变 `State` 在迭代间传递：

```ts
// src/query.ts:241-251
async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
>
```

事件类型层次：`StreamEvent` → `RequestStartEvent` → 各类 `Message` → `TombstoneMessage` → `ToolUseSummaryMessage`。**循环退出条件**：

- `!needsFollowUp`（无 `tool_use` 块）→ 跑 stop hooks → 收尾
- `maxTurns` / `taskBudget` / abort
- 错误（带可选 fallback 模型重试）

**循环检测工具调用的方式不可靠**：注释明确说 `stop_reason === 'tool_use'` 不可靠，**必须扫描流中是否出现 `tool_use` 块**：

```ts
// src/query.ts:551-558
const assistantMessages: AssistantMessage[] = []
const toolResults: (UserMessage | AttachmentMessage)[] = []
// Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly.
// Set during streaming whenever a tool_use block arrives — the sole loop-exit signal.
const toolUseBlocks: ToolUseBlock[] = []
let needsFollowUp = false
```

**两种工具执行模式**：

1. **流式**（`streamingToolExecution=true`）：`StreamingToolExecutor` 在 LLM 流期间就开始执行可并发只读工具
2. **批式**：流结束后 `runTools`（`src/services/tools/toolOrchestration.ts`）按"只读可并发 / 非只读串行"分批

**Takeaway**：

- 单文件 + async generator + `while(true)` + 注入 `deps.callModel` 已足够支撑生产级 agent loop
- 我们的图引擎是更结构化的方案，但要确认这层结构带来的好处 ≥ 它的复杂度
- **流式工具执行** + 批式 fallback 双轨值得借鉴

### 3.2 `Task` 抽象（**仅 UI + 生命周期**）

```ts
// src/Task.ts:72-76
export type Task = {
  name: string
  type: TaskType
  kill(taskId: string, setAppState: SetAppState): Promise<void>
}
```

**关键洞察**：`Task` **不是计算单元**。它是"在 UI 上显示的可 kill 的长活"的归一抽象。同一抽象下挂着：

- `LocalAgentTask` —— 同进程 local agent
- `InProcessTeammateTask` —— 同进程 swarm 成员（AsyncLocalStorage 隔离 + `agentName@teamName` 身份 + 邮箱通信）
- `LocalMainSessionTask` —— **主会话被 backgrounded**（Ctrl+B 二次按）
- `LocalShellTask` —— 后台 bash + stall 检测
- `RemoteAgentTask` —— 远端 CCR / Teleport 会话
- `DreamTask` —— 自动 dream 子代理的 UI 壳
- 其他 `local_bash` / `dream` 等

`**Task` 与 `query()` / Session 的关系**：

```
Session    = 会话级状态 (QueryEngine 持有)
              ↓
query()    = 一次"驱动到底"的 generator
              ↓ 可能 spawn
Task       = 后台可见、可 kill 的长活 UI 注册项
```

**Takeaway**：

- 把"计算"和"在 UI 上显示并可 kill"分开，是非常聪明的解耦
- 我们若做 secretary，对应抽象应该是：`**RunHandle`（计算）** + `**TaskRecord`（产品/UI）**——两者通过 ID 关联但生命周期独立

### 3.3 子代理（同一个 `query()`，不同 context）

```ts
// src/tools/AgentTool/runAgent.ts:520-528 (paraphrased)
const agentAbortController = override?.abortController
  ? override.abortController
  : isAsync
    ? new AbortController()  // async: 全新独立 controller
    : toolUseContext.abortController  // sync: 共享父 controller
```

`runAgent` 就是 `for await (const message of query({...}))`——**子代理与父用同一套 `queryLoop`，只是 `ToolUseContext` / `agentId` / 工具集 / 模型 / abort 策略不同**。

**异步 vs 同步**由 `shouldRunAsync` 计算：

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

**异步路径**：tool 立即返回 `{isAsync: true, status: 'async_launched', agentId, outputFile}`，主 loop 不阻塞。父拿结果通过 `**<task-notification>` XML 注入下一轮 user message**（"system 注入"模式）+ `**SendMessage` / `resumeAgentBackground`** 工具继续会话。

**同步路径**：在父的 generator 里完整 `for await` 子的 generator，结果汇总返回。

**Takeaway**：

- "子代理 = 同一引擎 + 不同 context" 比"另起一个引擎实例"清爽
- 异步子代理的"完成后注入下一轮 user message"模式，**直接验证了我们 `engine/01` §4 方案 A 的可行性**
- KAIROS 模式下**所有 spawn 默认异步**（防止 daemon inputQueue 堆积）——这条经验告诉我们：当 secretary 真的要常驻接消息时，**默认 sync 是错的**

### 3.4 Coordinator（**只是 env + 系统提示**）

`src/coordinator/coordinatorMode.ts` 只有一个文件：

- `isCoordinatorMode()`：检查 feature + env var
- `getCoordinatorSystemPrompt()`：返回固定的协调者角色 system prompt（含 Agent / SendMessage / TaskStop 工具约束、`<task-notification>` 格式契约、"不要替 worker 编造结果"）

**没有分布式调度器**。多 agent 编排靠：**system prompt 约束 + 必须异步 + 统一通知 XML 协议**。

### 3.5 Team（**文件 + 邮箱**）

- `TeamCreateTool`：写 **team 文件**到磁盘，含 `lead`、`members`、`leadSessionId`；每个 leader 同时只能有一个 team
- `SendMessageTool`：通过 `**writeToMailbox`** 投递；对 local agent 用 `queuePendingMessage` / `resumeAgentBackground`
- `TeamDelete`：清理；也注册 session cleanup

**没有自动 reduce 聚合**——lead 自己读 mailbox 通知。

### 3.6 Remote / direct-connect / bridge（**三套并存**，不是一套统一通道）


| 路径                                | 含义                   | 协议                                              |
| --------------------------------- | -------------------- | ----------------------------------------------- |
| `src/remote/RemoteSessionManager` | 接 Anthropic CCR 云端会话 | WS 收消息 + HTTP POST 发消息 + `control_request`      |
| `src/server/directConnectManager` | 自托管 BYOC 会话          | HTTP 建会话 + WS 订阅                                |
| `src/bridge/bridgeMain`           | IDE/remote-control 桥 | 注册 environment + 拉 work + per-session spawn 子进程 |


**关键设计**：**控制面与内容面分离**。`control_request` / `control_response` 走 WS，与 SDK 消息流并列。`can_use_tool` 这种权限请求是 control，不是 SDK message。

**远端权限的"合成"技巧**：远端工具调用时本地无真实 `AssistantMessage`，`remotePermissionBridge.ts` **合成一个 fake AssistantMessage** 让本地 UI 走同一套确认流程：

```ts
// src/remote/remotePermissionBridge.ts:7-11
/**
 * Create a synthetic AssistantMessage for remote permission requests.
 * The ToolUseConfirm type requires an AssistantMessage, but in remote mode
 * we don't have a real one — the tool use runs on the CCR container.
 */
```

**Takeaway**：

- 不要为"通道"做大一统抽象——CC 三套并存反而是有道理的，因为**控制面 vs 内容面的分离**比"统一通道"更重要
- 控制面用 `control_request` 这种结构化消息类型是金标准，比把权限消息塞进 SDK 流好

### 3.7 Cron（in-process scheduler + JSON 文件）

- **工具入口**：`CronCreateTool` → `addCronTask` 写到 `.claude/scheduled_tasks.json`
- **调度器**：`createCronScheduler`（`useScheduledTasks.ts` 启用），**进程内定时器 + 文件监视**，**不是外部 daemon**
- **门控**：`AGENT_TRIGGERS` flag + GrowthBook `tengu_kairos_cron`
- `print.ts`（无头模式）共用同一调度器

**Sleep 工具**——主动模式专用：

```ts
// src/tools/SleepTool/prompt.ts:7-16
export const SLEEP_TOOL_PROMPT = `Wait for a specified duration. The user can interrupt the sleep at any time.

Use this when the user tells you to sleep or rest, when you have nothing to do, or when you're waiting for something.

You may receive <${TICK_TAG}> prompts — these are periodic check-ins. Look for useful work to do before sleeping.

You can call this concurrently with other tools — it won't interfere with them.

Prefer this over \`Bash(sleep ...)\` — it doesn't hold a shell process.

Each wake-up costs an API call, but the prompt cache expires after 5 minutes of inactivity — balance accordingly.`
```

**Takeaway**：

- Cron 不需要外部 daemon，进程内定时器 + 磁盘 JSON store 已足够
- Sleep 工具 + `<tick>` 提示协议是"agent 自主等待 + 周期检查"的优雅做法
- linnsec 也可以让 LLM 自己用 `SleepTool`，这比把所有调度都做成 cron 灵活

### 3.8 长程工具：Worktree / Plan mode

- `**EnterWorktreeTool`**：`process.chdir` + `setCwd` + `saveWorktreeState`，并清理依赖 cwd 的 prompt 缓存（**会话级 cwd 切换**，无需 kernel 改动）
- `**EnterPlanModeTool`**：禁止在 agent context 调用；`setAppState` 把 permission mode 设为 `'plan'`——**纯权限/行为模式切换**
- `**SyntheticOutputTool`**：在非交互 SDK 模式下，让 LLM 用结构化 tool call 输出 JSON schema 内容

**Takeaway**：

- "长程工具"在 CC 里**完全不需要 kernel 暂停机制**——它们就是普通工具，副作用挂在 session/process 状态上
- 这进一步加强了 `engine/04-long-running-tool` 的判断：**我们大概率也不需要 wait_external 节点**

---

## 4. Memory & Dream（重点深挖）

### 4.1 记忆模型（**全文件，无向量**）

四种记忆类型：`user` / `feedback` / `project` / `reference`，可分 `private` / `team`。

**Markdown + YAML frontmatter**，无向量索引。检索靠**独立 Sonnet sideQuery + JSON schema 选最多 5 个文件**：

```ts
// src/memdir/findRelevantMemories.ts (paraphrased)
const SELECT_MEMORIES_SYSTEM_PROMPT = "..."
// 扫描目录 ≤200 个 .md，读 frontmatter，独立 Sonnet 调用返回 selected_memories JSON
```

**磁盘路径**：

- Auto memory：`<memoryBase>/projects/<sanitized-git-root>/memory/` (默认 `~/.claude`)
- Team memory：`.../memory/team/`
- 入口索引：`MEMORY.md`（每个范围一份）
- KAIROS 日志：`logs/YYYY/MM/YYYY-MM-DD.md`

**指令类记忆**（CLAUDE.md / rules）独立链：Managed / User / Project / Local。

### 4.2 上下文注入（三层）

1. **System prompt 层**：`loadMemoryPrompt()` 注入"记忆行为规范"（何时读 / 如何写 / 类型说明）
2. **User context 层**：`getUserContext` → `getMemoryFiles` → 把 CLAUDE.md + MEMORY.md 全文（截断后）拼进用户上下文
3. **Per-turn 附件层**：`getRelevantMemoryAttachments` → `findRelevantMemories` → `relevant_memories` 附件，按需挂相关 topic 文件内容

`**tengu_moth_copse` flag** 切换"始终带索引" vs "只附件预取"。

### 4.3 Memory age（**仅文案提示**）

`memoryAge.ts` 只对 >1 天的记忆附加 staleness 文案（"stale, may be outdated"），**无自动 eviction、无衰减评分**。清理靠 Dream 的 prune 阶段或人工。

### 4.4 自动 Memory 抽取

- **触发**：`stopHooks` 链中 fire-and-forget 调 `executeExtractMemories`，**每轮主对话结束**
- **门控**：`feature('EXTRACT_MEMORIES')` + GrowthBook `tengu_bramble_lintel`（每 N 轮节流）
- **互斥**：`hasMemoryWritesSince` 检查本轮是否已有对 auto-mem 目录的 Write/Edit，有则跳过——**主写优先**
- **执行**：fork 子代理，工具集受限（`createAutoMemCanUseTool`）
- **审批**：**无**——自动写盘，可选系统消息通知 "Saved N memories"

### 4.5 Team memory 同步

- API：`GET/PUT /api/claude_code/team_memory?repo=...` (OAuth)
- 协议：分批 PUT delta + ETag 412 冲突探测
- **Pull = 服务端覆盖本地**；删本地不删远端
- 安全：写 team 路径前 **gitleaks 式密钥扫描** + symlink 防逃逸
- **冲突合并粗**：同 key 并发写本地优先，可能覆盖队友

### 4.6 Compact（context 压缩）

- **触发**：`shouldAutoCompact`——估计 token 接近上下文窗口减 buffer（`AUTOCOMPACT_BUFFER_TOKENS = 13000`）
- **算法**：**再调一次模型生成长文摘要**，要求"仅文本、禁止工具"（`NO_TOOLS_PREAMBLE`）
- **结构**：`<analysis>` + `<summary>`，输出经 `formatCompactSummary` 提取 `<summary>`
- **保留**：可选保留最近若干轮原始消息（compact boundary message + summary user message + 后缀）
- **兜底**：摘要请求本身 prompt-too-long 时，按 API round 分组丢弃最旧块（`truncateHeadForPTLRetry`）

### 4.7 Dream feature（**重点**）

#### 是什么

**记忆巩固 ETL**——4 阶段：

```
Phase 1 — Orient        # 看一遍现有记忆地图
Phase 2 — Gather signal # 抓最近多 session 的痕迹
Phase 3 — Consolidate   # 合并、改写、把相对时间转绝对
Phase 4 — Prune & index # 删冗余、更新 MEMORY.md 索引
```

#### 何时跑

- **触发位置**：`stopHooks` 链（与 extract memories **同入口**），**每轮对话结束**检查
- **触发条件**（必须全满足）：
  - `minHours` (默认 24)
  - `minSessions` (默认 5)
  - 10 分钟扫描节流
  - `.consolidate-lock` 文件锁存在
  - 排除当前 session
- **不是**纯空闲定时器（虽然名字像"睡梦时跑"）

#### 提示词（verbatim 核心）

```
# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files.
Synthesize what you've learned recently into durable, well-organized memories
so that future sessions can orient quickly.

## Phase 1 — Orient
[读现有 MEMORY.md 与 topic 文件]

## Phase 2 — Gather recent signal
[抓 transcript / 待审 session 列表]

## Phase 3 — Consolidate
[合并、改写、绝对化时间]

## Phase 4 — Prune and index
[删旧、更新索引]

Return a brief summary of what you consolidated, updated, or pruned.
If nothing changed (memories are already tight), say so.
```

`extra` 字段在 auto 路径下附加：**只读 Bash 约束**、待审 session id 列表。

#### 实现

- DreamTask（`src/tasks/DreamTask/DreamTask.ts`）**仅是 UI 壳**——footer pill、状态、`filesTouched` 收集、kill 时 rollback lock
- 真正推理在 `src/services/autoDream/autoDream.ts` 的 `executeAutoDream`
- 用 `runForkedAgent` 派一个 sandbox 子代理，工具集限读 + memory 目录写

#### Feature 门控

- `isAutoDreamEnabled()` (settings + GrowthBook `tengu_onyx_plover`)
- KAIROS 模式下 auto-dream **关闭**，改由 KAIROS 自带的 disk skill 路径接管
- `initAutoDream` 在 `backgroundHousekeeping` 注册

### 4.8 Away summary（与 Dream 不同）

- `**useAwaySummary.ts`**：终端失焦 ≥5 分钟、无进行中 turn、自上次用户消息后无 away_summary 时，调 `generateAwaySummary` 插入一条 system 消息（subtype `away_summary`）
- 仅对**当前会话最近消息**做摘要，不动记忆目录
- **Dream = 跨 session 记忆整理；Away = 单 session 内最近回顾**

### 4.9 Memory 部分的 takeaway

1. **无向量也能工作**：frontmatter 摘要 + LLM 挑选 + `relevant_memories` 附件——成本可解释，可调
2. **三层注入**：system 行为规则 / user 上下文材料 / per-turn 附件——分层清楚
3. **主写与子代理写互斥**——避免重复
4. **Staleness 文案 > 自动 eviction**——便宜，对模型有效
5. **Dream = 可编排的 reflection 原语**：4 阶段 prompt + 文件锁 + 限制工具集，**值得抄 prompt 模板，不必抄 Anthropic 的调度细节**
6. **auto-extract 默认无审批**——对监管/合规场景必须改造
7. **Team memory 走服务端为真相源**——若我们要做团队记忆，需自建 backend 或用 Git

---

## 5. 工具框架

### 5.1 单一巨型 `Tool` 接口

```ts
// src/Tool.ts:362-467 (摘要)
export type Tool<Input, Output, P> = {
  call(args, context, canUseTool, parentMessage, onProgress?): Promise<ToolResult<Output>>
  description(input, options): Promise<string>
  inputSchema: Input  // Zod
  inputJSONSchema?: ToolInputJSONSchema  // MCP
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  maxResultSizeChars: number
  checkPermissions(input, context): Promise<PermissionResult>
  prompt(options): Promise<string>
  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
  renderToolResultMessage?: (...) => React.ReactNode
  // ... 等等
}
```

**设计评价**：⚠️ 单一接口承载 runtime + 权限 + UI + API 映射，耦合高。我们应该**拆开**。

### 5.2 工具注册

- **静态**：`getAllBaseTools()` 硬编码列表 + feature flag 条件展开
- **动态**：`assembleToolPool` 合并内置 + MCP，按缓存友好顺序排序，`uniqBy(name)` 内置同名优先

### 5.3 `ToolSearchTool`（**延迟工具发现**——非常聪明）

- **MCP 工具默认 `isDeferredTool: true`**，API 请求带 `defer_loading: true`
- LLM 先只看到工具**名字**，无完整 parameters
- `ToolSearchTool` 用关键词或 `select:ToolA,ToolB` 拉全量 schema，结果包在 `<functions>...</functions>` 注入下一轮
- `alwaysLoad` / `_meta['anthropic/alwaysLoad']` 让关键 MCP 工具不延迟

**Takeaway**：当 MCP 工具数 > 50 时，这条机制是必需的——直接进 system prompt 会爆 token。

### 5.4 MCP 集成

- 配置聚合：用户/项目 `.mcp.json` + 托管 + Claude.ai 下发 + 插件注入
- 传输：stdio / SSE / Streamable HTTP / WebSocket（官方 SDK transport）
- 重连：指数退避 + `ToolListChangedNotification` 后重新 `fetchToolsForClient`
- 命名：`mcp__server__tool`（可关闭前缀）
- 权限：默认 `passthrough`（=> ask 用户）+ 建议规则一键加 allow

---

## 6. 权限系统（深度学习对象）

### 6.1 权限模式

```ts
// src/types/permissions.ts:16-38
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const;

export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble';
```

- `default` —— 工具 `checkPermissions` 多返 `passthrough` → 弹给用户问
- `plan` —— 计划模式（只读倾向）
- `bypassPermissions` —— 整体放行**但仍尊重 deny 与内容级 ask**
- `acceptEdits` —— 编辑类自动允许
- `dontAsk` —— 末尾 ask → deny
- `auto` —— 分类器/启发式自动决策（feature 门控）

### 6.2 决策流（伪代码）

```
hasPermissionsToUseTool(tool, input, context):
  abort 检查
  全局 deny 规则 → deny
  全局 ask 规则 → ask（除 sandbox auto-allow）
  tool.checkPermissions(input):
    deny → deny
    requiresUserInteraction & ask → ask
    内容级 ask 规则 → ask（即使 bypass 也保留）
    safetyCheck ask → ask（bypass/auto 部分免疫）
  bypass 等价模式 → allow
  alwaysAllowed → allow
  passthrough → ask（进入 UI / hook / auto classifier）
  dontAsk: ask → deny
  auto: classifier / acceptEdits 影子评估 / denial tracking
```

### 6.3 持久化 destination

```ts
PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'
```

`policySettings` 等只读源不可删（`deletePermissionRule` 抛错）。

### 6.4 跨端权限（bridge / remote）

- `**bridgePermissionCallbacks**`：`sendRequest` / `sendResponse` / `onResponse` / `cancelRequest`
- `**interactiveHandler**`：`bridgeRequestId` + `claim()` 互斥防双 resolve
- **远端**：`remotePermissionBridge` 合成假 AssistantMessage，让本地 UI 走同一套

### 6.5 Hooks（用户自定义 shell 命令）

```ts
// src/utils/hooks.ts:1-5
/**
 * Hooks are user-defined shell commands that can be executed at various points
 * in Claude Code's lifecycle.
 */
```

事件点：`PreToolUse` / `PostToolUse` / `PermissionRequest` / `Stop`（见 `types/hooks.ts`）。Hook 返回 JSON 可改 input、改 MCP 输出、参与权限决策。**Shell hook 安全模型弱，多租户场景需替换。**

### 6.6 权限部分 takeaway

- ⭐⭐ 权限决策状态机非常成熟，值得直接学习实现细节
- "passthrough → ask" 把工具语义与交互解耦，可借鉴
- bypass 仍尊重 deny + safety + 内容 ask，是"安全底线 + 爽模式"的折中
- 跨端权限的 `claim()` 单次 resolve 是必要细节
- Hooks 的 JSON 协议比纯日志埋点强大太多

---

## 7. Skills

- **Bundled skills 是 TS 文件里嵌的 Markdown 字符串**：

```ts
// src/skills/bundled/remember.ts:9-22
const SKILL_PROMPT = `# Memory Review

## Goal
Review the user's memory landscape and produce a clear report of proposed
changes, grouped by action type. Do NOT apply changes — present proposals
for user approval.

## Steps

### 1. Gather all memory layers
Read CLAUDE.md and CLAUDE.local.md from the project root (if they exist).
Your auto-memory content is already in your system prompt — review it there.
Note which team memory sections exist, if any.
...
`
```

- **磁盘 skills**：`loadSkillsDir.ts` 扫 `.claude/skills/<skill>/SKILL.md`，frontmatter
- `**SkillTool`** fork 子代理执行 skill prompt
- **MCP prompts** 也作为 skill 候选（通过 `mcpSkillBuilders.ts` 桥接，避免循环依赖）
- **优先级**：`uniqBy([...local, ...mcpSkills], 'name')` 本地优先

**Takeaway**：

- Skill = 可编排的提示词包；MCP = 可调用工具——两者**不要混为一谈**
- 用单个 `SkillTool` 作为统一调用入口（让 LLM 调 `Skill('memory-review')` 而不是 `MemoryReviewTool`）

---

## 8. 进程模型 & 持久化

### 8.1 多种运行形态

CLI 入口在 `src/entrypoints/cli.tsx` 早期分叉：

```
$ claude               → 默认 REPL（per-session 进程）
$ claude daemon ...    → supervisor 进程（feature DAEMON）
$ claude --daemon-worker=<kind>  → worker 子进程
$ claude remote-control → bridge（接 Anthropic CCR / claude.ai）
$ claude bg/ps/attach/kill → 后台会话操作
$ claude print/--print → 无头模式
```

**结论**：CC **不是**"单一全局 daemon + 所有 CLI 仅作客户端"，而是 **同一二进制按子命令分流**。

### 8.2 Session 持久化

- **本地 transcript**：`~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`（append-only JSONL）
- **进程注册**：`~/.claude/sessions/{pid}.json`（`claude ps` 用）
- **云端 events**：`GET /v1/sessions/{id}/events`（OAuth）
- `**/resume`**：从 jsonl 重建消息链；**支持跨进程恢复**
- `**MAX_TRANSCRIPT_READ_BYTES = 50MB`** 防内存爆

### 8.3 Handoff（`/desktop` / `/mobile`）

- `**/desktop**`：`flushSessionStorage()` → `claude://resume?session=...&cwd=...` deep link → `gracefulShutdown`
- `**/mobile**`：⚠️ **仅是个二维码**，引导下载 App，**不是会话迁移**

### 8.4 Voice

- `voiceModeEnabled.ts`：GrowthBook 总开关 `tengu_amber_quartz_disabled` + **必须 OAuth**（API key 用不了 voice endpoint）
- `voiceStreamSTT.ts`：push-to-talk，连 `voice_stream` WS，JSON 控制 + 二进制音频帧
- **Voice 不是 channel**，是输入模态——转文本后进入与打字一样的用户消息管线

---

## 9. 工程化质量评估


| 维度    | 评估                                                              |
| ----- | --------------------------------------------------------------- |
| 架构清晰度 | ⭐ 顶层分层清晰；模式多但每条都有目的                                             |
| 协议设计  | ⭐⭐ 控制面 vs 内容面分离；`<task-notification>` 等 XML 协议；JSON hook schema |
| 模块边界  | ⭐ 大部分模块单一职责；少数（`Tool.ts` / `query.ts`）单文件过大                     |
| 测试覆盖  | 未在快照中看到测试，可能未泄露；从代码组织看应有测试                                      |
| 代码质量  | ⭐⭐ 命名一致、注释精确、错误处理完整；远超 OpenClaw                                 |
| 协议稳定性 | ⭐ 通过 SDK + control schemas 显式分离                                 |
| 文档/注释 | ⭐⭐ 注释经常解释 "为什么这样" 而不是 "做了什么"                                    |
| 性能    | ⭐⭐ 启动时并行预取、defer_loading、prompt cache 显式工程化                     |
| 可维护性  | ⭐ 总体好；feature flag 矩阵给维护带来一些负担                                  |


---

## 10. 对我们的启发清单（按 topic 归档）

### → engine/01-async-runs-and-handles

- ✅ `**runAgent` = `query()` + 不同 ToolUseContext** 是子代理的最干净建模
- ✅ **异步路径立即返回 `{agentId, outputFile, status: 'async_launched'}`**——直接验证我们方案 A 可行
- ✅ **完成后通过 `<task-notification>` 注入下一轮 user message**——announce 模式的具体实现
- ✅ **KAIROS 模式默认所有 spawn 异步**——常驻 daemon 必须默认 async
- ✅ `**Task` 抽象 = UI presence + kill + disk output**，与 query 正交——值得抄
- ⚠️ CC 没有 `RunHandle`/`runId` API 暴露给外部进程，但有 `taskId` 在 AppState 里——**说明 in-process 用 state Map 就够；跨进程才需要 handle**

### → engine/02-session-and-tenancy

- ✅ Session = `sessionId` + `~/.claude/projects/<cwd-hash>/<sessionId>.jsonl` append-only
- ✅ `getProjectDir(cwd)` 把工作目录归一化为 project key——避免路径漂移
- ⚠️ CC 的"session"概念跟 IM peer/thread 无关——**对 secretary 的多通道场景，session-key 设计需自己来**

### → engine/03-memory-port

- ✅ 全文件 + frontmatter + LLM picker，**无向量也能工作**
- ✅ 三层注入（system 行为 / user 材料 / per-turn 附件）
- ✅ `findRelevantMemories` 用独立 Sonnet sideQuery + JSON schema
- ✅ Auto extract on stop hook + 互斥写
- ✅ `memoryAge` 仅文案 staleness——便宜有效
- ⚠️ 自动写无审批——合规场景需改造
- ⚠️ Team memory 服务端为真相源——多用户协作要自建 backend

### → engine/04-long-running-tool

- ✅ **Worktree、Plan mode 都是普通工具 + state 副作用**——**完全不需要 kernel 暂停**
- ✅ Sleep 工具 + `<tick>` 周期检查协议——主动等待的优雅做法
- ✅ 这进一步加强：**我们也不需要 wait_external 节点**

### → engine/05-external-agent-tool-protocol

- ✅ **统一 `Tool` 接口**承载内置 + MCP + remote stub
- ✅ MCP 工具命名 `mcp__server__tool` + `_meta` 元数据约定
- ✅ `defer_loading` + `ToolSearchTool` 解决 MCP 工具爆炸
- ✅ `passthrough` permission 把工具语义与交互解耦
- ✅ "remote stub Tool" 让本地 UI 处理远端工具的权限请求

### → engine/06-checkpointer-and-persistence

- ✅ JSONL + `MAX_TRANSCRIPT_READ_BYTES = 50MB`——append-only 简单可靠
- ✅ `getProjectsDir()` 路径策略
- ✅ Session id + 进程 pid 注册分离
- ✅ `/resume` 流程值得借鉴
- ⚠️ 我们已有 EventStore 模型，比 JSONL 更结构化，不退化

### → engine/07-public-api-and-boundary

- ✅ `entrypoints/sdk/controlSchemas.ts` 用 Zod 定义控制平面消息——**stable contract**
- ✅ 子命令分流（daemon / bridge / bg / remote-control）的 fast-path 设计

### → engine/08-cross-cutting

- ✅ 注入式 `deps.callModel` 便于测试
- ✅ **控制面与内容面分离**（`control_request` vs SDK message）——这条要进我们的设计原则
- ✅ Hook 用 JSON schema 协议比 shell stdout 强

### → secretary/02-gateway-daemon

- ✅ **Supervisor + worker subprocess** 模式（`claude daemon` + `--daemon-worker`）——比"单进程 REPL"更适合常驻
- ⚠️ CC 的 daemon 实现不在快照里，但接口已定义
- ✅ `~/.claude/sessions/{pid}.json` 进程注册表——多进程协调

### → secretary/03-channel-adapter-framework

- ✅ **不要做大一统通道抽象**——CC 三套并存（remote/bridge/direct-connect）反而清晰
- ✅ 控制面与内容面分离比"统一通道"更重要

### → secretary/04-dm-security-and-pairing

- ✅ `workSecret`/`jwtUtils`/`trustedDevice` 的 token 模型
- ✅ `policyLimits` 组织策略 + remote managed settings——企业部署细节

### → secretary/05-scheduler-subsystem

- ✅ **进程内 cron + JSON 文件 store** 已足够
- ✅ Sleep 工具 + tick 协议——agent 自主等待
- ✅ `AGENT_TRIGGERS` flag 把 cron 变成可独立开关的能力

### → secretary/06-memory-backends

- ✅ 全文件 + frontmatter + LLM picker（无向量）
- ✅ `~/.claude/projects/<sanitized>/memory/` 路径策略
- ✅ MEMORY.md 索引 + topic 文件两级分层
- ✅ Team memory 用服务端 API + ETag 冲突检测——若做团队需自建
- ✅ `gitleaks` 式密钥扫描 + symlink 防逃逸——安全前置值得抄

### → secretary/07-skills-and-workspace

- ✅ Bundled skills = TS 内嵌 Markdown 模板——版本管理友好
- ✅ Skill ≠ Tool ≠ MCP——三种独立抽象
- ✅ `SkillTool` 作为统一调用入口
- ✅ `loadSkillsDir.ts` 路径优先级（bundled / user / project / policy / plugin）

### → secretary/08-node-protocol

- ✅ Bridge 注册 environment + 拉 work + per-session spawn——比"node 永远在线声明 caps"更鲁棒
- ✅ JWT ingress token + heartbeat lease 续约
- ⚠️ 但 CC 是 cloud→local 方向；我们若做 local secretary→remote phone，方向反过来

### → secretary/09-sandbox-and-permission

- ⭐⭐ **全套权限状态机直接学习**（`utils/permissions/permissions.ts`）
- ⭐⭐ 5+ 种 permission mode + 决策伪代码
- ⭐⭐ Hooks 的 JSON 协议
- ⭐ `policyLimits` 组织策略
- ⚠️ Bash 沙箱具体实现未深读

### → secretary/11-external-agent-tools

- ✅ 远端工具调用 = 统一 Tool 接口 + 远端权限合成
- ✅ MCP 是首选机制，OAuth 凭据由用户/MCP server 自己管

### → secretary/12-voice-canvas-future

- ✅ Voice = 输入模态而非 channel
- ✅ Push-to-talk + WS audio 协议

---

## 11. 最值得抄的 10 个具体设计

按抄作业难度从低到高排序：

1. `**<task-notification>` XML 注入下一轮** 实现父子异步通信（极简）
2. `**Task` = UI 注册项 + kill 接口**，与 query 正交（极简，立即可用）
3. **Sleep 工具 + `<tick>` 周期检查** 实现 agent 自主等待
4. `**memoryAge` 仅做 staleness 文案** 而非自动 eviction（便宜，效果好）
5. `**findRelevantMemories` LLM sideQuery** 选 ≤ 5 个 frontmatter（无向量）
6. `**ToolSearchTool` + `defer_loading`** 缓解 MCP 工具爆炸
7. **Dream 4 阶段 prompt（orient → gather → consolidate → prune）**
8. **权限 5 模式状态机 + passthrough** 把工具语义与交互解耦
9. **Hooks JSON schema 协议** 用户可改 input/output/permission
10. **控制面与内容面分离**（`control_request` vs SDK message）

---

## 12. 不要抄的部分

1. **单文件 ~46K 行的 `query.ts`/`Tool.ts`**——多团队长期堆叠的产物，新项目应模块化
2. **GrowthBook + `feature()` flag 矩阵**——产品绑定强，迁移行为漂移
3. **进程级 `chdir` worktree**——多租户/库场景危险
4. **强 Anthropic OAuth + claude.ai 产品面绑定**（bridge / remote / voice / team memory）
5. **Ink/React 终端 UI 与全局 `AppState` 深度耦合**
6. **Bundled skills 注册为空 + mcpSkills.js 未在快照中**——别假设我们看到的就是全部
7. **Auto-extract memory 无审批默认开**——合规风险
8. `**/mobile` 是营销二维码**——别误以为是会话迁移协议
9. **shell hook**——多租户服务端不可直接搬

---

## 13. 后续深挖待办

如果某 topic 工作时需要更深，回头精读：

- `src/utils/permissions/permissions.ts`（权限状态机完整实现） —— 设计 secretary/09 时
- `src/services/autoDream/autoDream.ts` + `consolidationPrompt.ts` —— 设计 memory consolidation 时
- `src/memdir/findRelevantMemories.ts` 的 sideQuery 系统 prompt —— 设计 memory retrieval 时
- `src/services/compact/` 完整算法 —— 设计 compaction 策略时
- `src/utils/hooks.ts` + `types/hooks.ts` —— 设计 hook 协议时
- `src/services/mcp/client.ts` 重连/auth 流程 —— 设计 MCP 集成时
- `src/bridge/bridgeMessaging.ts` + `controlSchemas.ts` —— 设计控制面协议时
- `src/utils/sessionStorage.ts` JSONL 完整 schema —— 设计 secretary 持久化时
- `src/tools/SleepTool/prompt.ts` 完整 + `query.ts` 中 SLEEP_TOOL_NAME 处理 —— 设计 agent 主动等待时
