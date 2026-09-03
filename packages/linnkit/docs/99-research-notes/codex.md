# OpenAI Codex CLI

> 调研日期：2026-04-20  
> 调研深度：深（4 个 explore subagent 并行覆盖 94 个 crates / ~2000+ Rust 源文件）  
> 质量评估：⭐⭐ 工程质量极高，**模块化纪律**远胜 CC（强制规则 "模块 < 500 LoC, 文件 < 800 LoC"）；同时有部分"已画好 trait 但尚未落地"的留白（如 RemoteThreadStore）  
> 借鉴边界：⭐⭐ **多处可直接学习架构与实现细节**（double-loop 结构、execpolicy DSL、Guardian、ContextManager diff 注入、Rollout 策略分层）；少数强绑定处 ⚠️ 勿抄（Responses Compact API、Starlark DSL、WebRTC macOS-only、ChatGPT Apps connectors 概念）

仓库位置（本机）：`<upstream-workspace>/codex/`（openai/codex master 浅 clone）
语言：Rust（`codex-rs/`*，94 crates）+ 薄 npm 封装（`codex-cli/`）  
构建：Bazel + Cargo 双栈

---

## 0. 顶层判断（必读）

Codex 与 CC 在**工程气质**上是两个极端：

- CC 追求"单文件承载复杂度"——`Tool.ts` 29K 行、`query.ts` 46K 行；feature flag 矩阵承载演进
- Codex 追求"crates + trait + 纯数据结构"——大量独立 crate，每个模块 < 500 行，类型系统做守门员

**架构上 Codex 在我们关心的几乎所有维度都比 CC 更清晰**：

- 双层循环（外层 Op channel + 内层 stream 循环）
- ContextManager + **reference_context_item diff 注入**（首轮全量 + 后续增量）——CC 没这个
- **三层持久化**：JSONL rollout (权威磁带) + SQLite state_db (索引) + session_index.jsonl (名索引)
- **Guardian**：用独立小模型做结构化 allow/deny 审批（一等公民）
- **Execpolicy 用 Starlark DSL** 写执行策略规则
- **Code mode / JS REPL 双轨**：V8 编排 vs Node REPL
- **AgentPath 树形命名空间** `/root/task1/task_3` + mailbox 通信
- **Memory 子系统**（与 CC Dream 性质相同但调度不同）：启动时 2 阶段（extract → consolidate），不是每轮末尾

但也有两处 Codex **不如** CC 清晰：

- `hierarchical_agents_message.md` 文件名与内容不一致（实际是 AGENTS.md 作用域说明）
- `external_agent_config.rs` 里的"external agent"其实是**从 Claude 配置迁移**，不是通用外部 runtime 抽象

---

## 1. 项目定位

- **形态**：Rust CLI + TUI + app-server（daemon）+ cloud-tasks 客户端
- **多入口**：`codex` (TUI 默认) / `codex exec` (单次) / `codex review` / `codex mcp-server` / `codex app-server` / `codex cloud[-tasks]` / `codex exec-server` / `codex stdio-to-uds`
- **服务面向**：单开发者 + 可选团队协作 + ChatGPT 账户生态（cloud tasks, Apps connectors）
- **协作宿主**：VS Code 扩展等通过 `app-server`（JSON-RPC over stdio/WS）驱动
- **嵌入能力**：作为 MCP server 被别的 agent 调用（暴露 `codex` / `codex-reply` 工具）

---

## 2. 顶层目录与代码组织

### 2.1 `codex-rs/` 主要 crates


| Crate                                                                                                            | 角色                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `core`                                                                                                           | 核心：Session、turn loop、agent tree、memory pipeline、compact、instructions、guardian |
| `protocol`                                                                                                       | 领域协议类型（ResponseItem、EventMsg、Op、AgentPath、ThreadId、approvals、permissions）     |
| `tools`                                                                                                          | 工具定义与规格（ToolDefinition、ToolSpec、ToolRegistryPlan）                             |
| `app-server` / `app-server-protocol` / `app-server-client`                                                       | **一等 daemon** + JSON-RPC 契约 + 客户端 SDK                                         |
| `rollout`                                                                                                        | 会话 JSONL 持久化（recorder、session_index、state_db、policy）                          |
| `state`                                                                                                          | 运行时状态 + SQLite + 迁移                                                           |
| `thread-store`                                                                                                   | `ThreadStore` trait + local 实现 + remote (gRPC) stub                           |
| `cloud-tasks` / `cloud-tasks-client`                                                                             | Codex Web 云端 agent 集成（Exec/Status/List/Apply/Diff）                            |
| `code-mode` / `v8-poc`                                                                                           | V8 嵌入（code mode 编排）                                                           |
| `sandboxing` / `linux-sandbox` / `windows-sandbox-rs` / `process-hardening` / `execpolicy` / `execpolicy-legacy` | **重型沙箱基础设施**                                                                  |
| `hooks`                                                                                                          | Claude-compatible hook engine                                                 |
| `skills` / `core-skills`                                                                                         | SKILL.md 扫描 + 注入                                                              |
| `connectors`                                                                                                     | ChatGPT Apps 目录合并（**不是** 通道抽象）                                                |
| `codex-mcp` / `mcp-server` / `rmcp-client`                                                                       | MCP 客户端 + Codex 作为 MCP server                                                 |
| `chatgpt` / `backend-client` / `login` / `keyring-store` / `secrets`                                             | 认证链                                                                           |
| `realtime-webrtc`                                                                                                | 语音（macOS-only libwebrtc）                                                      |
| `tui`                                                                                                            | 终端 UI（React/Ink 的 Rust 版 ratatui）                                             |
| `cli` / `exec` / `exec-server`                                                                                   | CLI 入口 / 非交互 / 执行服务                                                           |
| `stdio-to-uds`                                                                                                   | socat-lite（stdio ↔ Unix socket 桥）                                             |
| `shell-command` / `shell-escalation`                                                                             | shell 执行 + 提权 IPC                                                             |
| `apply-patch`                                                                                                    | V4A 风格 diff 格式 + parser                                                       |
| `instructions`                                                                                                   | UserInstructions / SkillInstructions / DeveloperInstructions 类型               |


### 2.2 工程纪律

`AGENTS.md`（根）明确：

- "Target Rust modules under 500 LoC, excluding tests"
- "If a file exceeds roughly 800 LoC, add new functionality in a new module"
- "Prefer private modules and explicitly exported public crate API"
- "Newly added traits should include doc comments"

**这与 CC 的 46K 行单文件形成尖锐对比**。Codex 是我们可以直接借鉴 code organization 的典范。

### 2.3 官方架构文档（自带！）

- `codex-rs/docs/protocol_v1.md` —— 内核 SQ/EQ 协议规范
- `codex-rs/docs/codex_mcp_interface.md` —— 作为 MCP server 的接口
- `codex-rs/core/README.md` —— **比 docs/sandbox.md 更完整的沙箱说明**
- `codex-rs/app-server/README.md` —— 对外 JSON-RPC 契约
- `core/gpt-5.2-codex_prompt.md` 等 —— **所有版本的 system prompt**
- `core/hierarchical_agents_message.md` —— AGENTS.md 优先级说明（**文件名误导**）
- `core/review_prompt.md` —— code review 模式 prompt
- `core/templates/collab/experimental_prompt.md` / `templates/agents/orchestrator.md` —— 多 agent 协作模板
- `core/templates/compact/prompt.md` + `summary_prefix.md` —— compact 模板
- `core/templates/memories/consolidation.md` —— **memory 巩固子代理 prompt**

---

## 3. 核心架构主线

### 3.1 Agent 主循环：**双层循环**（非 async generator）

Codex 采用 **会话层 Op channel + turn 层 stream 循环** 的双层设计：

```rust
// codex-rs/core/src/session/handlers.rs:1005-1012
pub(super) async fn submission_loop(
    sess: Arc<Session>,
    config: Arc<Config>,
    rx_sub: Receiver<Submission>,
) {
    // To break out of this loop, send Op::Shutdown.
    while let Ok(sub) = rx_sub.recv().await {
        // 按 Op 分发：UserTurn / ExecApproval / Interrupt / Shutdown / ...
```

内层 turn 循环（`codex-rs/core/src/session/turn.rs:1043+`）：

```rust
let mut retries = 0;
let mut initial_input = Some(input);
loop {
    let prompt_input = /* ... */;
    let prompt = build_prompt(/* ... */);
    let err = match try_run_sampling_request(/* stream.next() 循环 */).await {
        // retry with fallback / exit conditions
    };
}
```

**关键设计**：

- 外层：`Op` 枚举 + `async_channel`，清晰状态机
- 内层：对 LLM provider 的流式 stream 迭代
- 取消：`CancellationToken` / `or_cancel` 显式
- 子代理：**独立 `Codex::spawn`** + `SessionSource::SubAgent` + `AgentControl` tree，**不是**把子代理塞进父 generator

**对比 CC**：

- CC = 单个 async generator + `while(true)` + 注入 deps
- Codex = channel-based actor model，两层循环职责分离

**Takeaway**：双层结构对图引擎而言更自然——外层可以是"图调度器"，内层是"单节点 LLM 调用"。Rust/TS 语言特性不是决定因素。

### 3.2 Delegate 模式（`codex_delegate.rs`）

**发现**：文件中**并没有 `CodexDelegate` struct**。它提供的是一组**桥接函数**：

- `run_codex_thread_interactive` / `run_codex_thread_one_shot`
- `forward_events` / `forward_ops`

核心职责：**把子 agent 的审批类事件（exec approval、patch approval、permission、request_user_input）转交给父 Session 决策**，其余事件透传。

```rust
// codex_delegate.rs 核心意图（paraphrased）
fn forward_events(child_events: Receiver, parent_session: &Session) {
    for event in child_events {
        if event.is_approval_request() {
            parent_session.ask_approval(event).await;  // 上浮到父 UI
        } else {
            parent_session.emit(event);  // 透传给 UI
        }
    }
}
```

**Takeaway for our project**：

- "子图节点把权限请求路由到父作用域"是可直接借鉴的模式
- 避免每个子代理都复制一套审批状态机
- 我们的 `WaitUserNode` 可演进为"任何层级的 pause 都冒泡到顶层会话"

### 3.3 Agent 身份 & Agent Path（重点）

**两种 ID 并存**：

1. `**AgentIdentity` (`core/src/agent_identity.rs`)**：**云端身份**
  - ed25519 keypair + `agent_runtime_id` + `chatgpt_account_id` + AgentBillOfMaterials
  - 向 ChatGPT 后端注册，用于 cloud-tasks 等
  - **与 hierarchical agents 无直接关系**
2. `**AgentPath` (`protocol/src/agent_path.rs`)**：**编排树路径**（Unix 风格）

```rust
impl AgentPath {
    pub const ROOT: &str = "/root";
    pub const MORPHEUS: &str = "/morpheus";  // 特判
    // ...
    pub fn join(&self, agent_name: &str) -> Result<Self, String>
    pub fn resolve(&self, reference: &str) -> Result<Self, String>
    // 支持 "/root/task1/task_3" 绝对路径
    // 支持 "task_3" 相对路径（join 到当前）
}
```

传播通过 `AgentRegistry::agent_tree: HashMap<String, AgentMetadata>`（含 `agent_path`、`agent_id: ThreadId`）。

**与 CC "team" 对比**：

- CC: team = 文件元数据 + 邮箱地址 + lead session id（"扁平的小组"）
- Codex: agent tree = 真正的树形命名空间（`/root/a/b/c` 绝对路径 + 相对解析）

**Takeaway**：**身份（云/跨实例）** vs **路径（编排树）** 应该分开建模。我们如果要做 hierarchical agents，`AgentPath` 模型可直接移植。

### 3.4 子代理：`agent_tool` vs `agent_job_tool`（大问题）

Codex 把"多 agent 编排"拆成**两套工具族**：

#### A) `agent_tool.rs` —— 协作原语（通用）

工具族：`spawn_agent` / `send_input` / `wait_agent` / `list_agents` / `close_agent`

`**spawn_agent` 语义**（工具 description 内嵌）：

```
Spawns an agent to work on the specified task. If your current task is 
`/root/task1` and you spawn_agent with task_name "task_3" the agent will 
have canonical task name `/root/task1/task_3`.
You are then able to refer to this agent as `task_3` or `/root/task1/task_3` 
interchangeably.
```

- **异步**：spawn 后立即返回（不等子 agent 跑完）
- **异步结果**：父通过 `**wait_agent`**（阻塞在 mailbox 序列）或 `**<subagent_notification>` 片段注入**（类似 CC 的 `<task-notification>`）获取
- **inter-agent communication**：通过 `mailbox.rs` + `InterAgentCommunication`
- **实现**：`core/src/tools/handlers/multi_agents_v2/`

#### B) `agent_job_tool.rs` —— 批处理（map-reduce）

工具族：`spawn_agents_on_csv` / `report_agent_job_result`

```rust
// tools/src/agent_job_tool.rs:55-63
ToolSpec::Function(ResponsesApiTool {
    name: "spawn_agents_on_csv".to_string(),
    description: "Process a CSV by spawning one worker sub-agent per row. 
                  ... This call blocks until all rows finish and automatically 
                  exports results to `output_csv_path` ..."
```

- **同步（阻塞主 turn）**：CSV 跑完才返回
- Worker 用专用 `report_agent_job_result` 上报结构化结果
- `BatchJobHandler` 在 `core/src/tools/handlers/agent_jobs.rs`，含进度、state_db、并发上限

**为什么分两套？**

- `agent_tool` = **灵活异步编排**（长任务、交互、不确定步数）
- `agent_job_tool` = **结构化批处理**（fan-out, reduce, 已知输入集）

**对比 CC 的统一 `AgentTool`**：Codex 把"协作控制面"和"批处理 job"分成独立工具族与 handler，语义不纠缠。

**Takeaway for our project**：

- ⭐ **"原语级 spawn/wait/message" vs "工作流级 CSV job"** 应分层，不做一个万能工具
- 我们如果只做 secretary，先有 `agent_tool` 等价物（spawn/wait/close）就够；CSV job 可延后

### 3.5 Hierarchical agents 真相

`**hierarchical_agents_message.md` 文件名误导**。其内容实际是 **AGENTS.md 作用域与优先级说明**：

```
Files called AGENTS.md commonly appear in many places inside a container - 
at "/", in "~", deep within git repositories, or in any other directory...

Each AGENTS.md governs the entire directory that contains it and every child 
directory beneath that point. Whenever you change a file, you have to comply 
with every AGENTS.md whose scope covers that file...

When two AGENTS.md files disagree, the one located deeper in the directory 
structure overrides the higher-level file, while instructions given directly 
in the prompt by the system, developer, or user outrank any AGENTS.md content.
```

**真正的 hierarchical agents 设计在代码里**：

- `AgentPath` 树形路径
- `AgentRegistry::agent_tree`
- `templates/agents/orchestrator.md` 协作模板

**Takeaway**：⚠️ 文件名与内容严重不一致，**千万别照抄命名**；concept 本身（树 + mailbox）值得借鉴。

### 3.6 External Agent（踩坑警告）

`core/src/external_agent_config.rs` 里的 "external" 是**从 `~/.claude` / `CLAUDE.md` 迁移配置**到 Codex，**不是**通用"外部进程 agent 运行时"抽象。

通用外部能力在 Codex 里分散到：

- **MCP** (`codex-mcp` + `mcp-server`) —— 标准协议
- **cloud-tasks** —— OpenAI 托管
- **connectors** —— ChatGPT Apps 生态

**Takeaway**：⚠️ "external agent" 一词在 Codex 里有歧义。我们的 `engine/05-external-agent-tool-protocol` 应该定义清楚："external" 指**协议层面的外部能力**（MCP + CLI 子进程 + HTTP 端点），而不是"从别的产品迁移"。

### 3.7 Cloud Tasks（Codex Web 云端 agent）

`cloud-tasks/` + `cloud-tasks-client/`：

- CLI 子命令：`Exec` / `Status` / `List` / `Apply` / `Diff`
- Backend：`https://chatgpt.com/backend-api`（需 ChatGPT 账户）
- 流程：**本地 CLI 提交 query + env_id + branch → 云端跑 → 拿 diff → 本地 apply**
- 与本地 `spawn_agent` **是两个维度**（云托管 vs 进程内多会话）

**Takeaway**：

- Codex 验证了"云端 detached run + 本地 apply"是可行的产品模式
- 对 linnsec 而言：**本地 daemon 可以向 Linnya / Claude Code / Codex Web 等分发云/桌面任务**（正是你想要的）
- 但这是**产品层面的 dispatch**，不需要 engine 层抽象

### 3.8 Plan Tool（结构化计划）

```rust
// tools/src/plan_tool.rs:33-47
ToolSpec::Function(ResponsesApiTool {
    name: "update_plan".to_string(),
    description: r#"Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
"#
```

System prompt 配合约束：

```
## Plan tool

When using the planning tool:
- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).
- Do not make single-step plans.
- When you made a plan, update it after having performed one of the sub-tasks 
  that you shared on the plan.
```

**Takeaway**：计划是**结构化数据**（`[{step, status}]` + "at most 1 in_progress"）而不是非结构化文本——这让 UI 可直接渲染，状态机可直接追踪。

### 3.9 Request User Input（结构化多选）

`tools/src/request_user_input_tool.rs`：

- 结构化多选问卷：`questions: [{prompt, options: [..., 2-3个]}]`
- 客户端可加 "Other" 选项
- **与权限系统分离**：权限在 `exec_policy` / approvals / Guardian 各自独立

**对比 CC**：CC 的 `WaitUserNode` 更通用（任意 pending spec），Codex 更结构化。

**Takeaway**：把"选择题"与"策略审批"分离，减少 LLM 滥用"问一下"的频率。

---

## 4. Memory & Context（Codex 也有 Dream-like 系统）

### 4.1 ContextManager（专门的子模块）

`core/src/context_manager/`：


| 文件             | 作用                                                     |
| -------------- | ------------------------------------------------------ |
| `mod.rs`       | 导出 ContextManager、TotalTokenUsageBreakdown、updates 子模块 |
| `history.rs`   | transcript + reference_context_item + token 粗估         |
| `normalize.rs` | 历史规范化（与 `for_prompt` 配合）                               |
| `updates.rs`   | **把"会话状态 → 要追加的 developer/contextual user 消息"**        |


核心类型：

```rust
// context_manager/history.rs:32-51
pub(crate) struct ContextManager {
    /// The oldest items are at the beginning of the vector.
    items: Vec<ResponseItem>,
    /// Bumped whenever history is rewritten, such as compaction or rollback.
    history_version: u64,
    token_info: Option<TokenUsageInfo>,
    /// Reference context snapshot used for diffing and producing model-visible
    /// settings update items.
    reference_context_item: Option<TurnContextItem>,
}
```

**关键创新（我们之前没见过）**：**reference_context_item + diff 注入**

- 首轮：注入完整 environment / permissions / apps / skills 等
- 后续每轮：对比当前 `TurnContextItem` vs `reference_context_item`
- 只注入**变化的部分**（`build_environment_update_item` 等）
- 大幅降低长会话 token 消耗

**对比 CC**：CC 的 `getUserContext` 每轮都把 CLAUDE.md + MEMORY.md 重新拼入——Codex 这套更先进。

**Takeaway for our project**：

- ⭐⭐ **"基线快照 + 差量注入"** 是长会话 token 管理的一等策略
- 我们的 context-manager 应该抄这个模式：维护 `reference_turn_context`，每轮只注入 diff
- 这条设计**单独值得一个 engine topic**（context baseline & diff injection）

### 4.2 AGENTS.md 处理

**扫描路径**：从 cwd **向上**到 project root（由 `project_root_markers` 决定，默认含 `.git`），每个目录按候选文件名找第一个存在的文件，**按 root→deep 顺序串联，用 `\n\n` 分隔**。

**全局**：`$CODEX_HOME/AGENTS.override.md` 优先于 `$CODEX_HOME/AGENTS.md`。

**注入形态**：包成 user 消息带固定标记：

```rust
// instructions/src/user_instructions.rs:19-51
impl UserInstructions {
    pub fn serialize_to_text(&self) -> String {
        format!(
            "{prefix}{directory}\n\n<INSTRUCTIONS>\n{contents}\n{suffix}",
            prefix = AGENTS_MD_FRAGMENT.start_marker(),
            // ...
        )
    }
}
```

**⚠️ 语义 vs 实现不一致**：

- `hierarchical_agents_message.md` 说"**深层覆盖浅层**"
- 但实现是"**串联**"
- 实际效果：靠 LLM 阅读提示中的 override 语义自己判断

### 4.3 Memory 子系统（Codex 的 Dream-like）

`core/src/memories/` —— 启动时 2 阶段 pipeline：

```
Phase 1 — Startup Extract
  输入：state DB 里的 rollout
  输出：raw_memory / rollout_summary 落库
  要求：非 ephemeral + feature 开启 + state DB 存在 + 非 sub-agent
  执行：后台异步

Phase 2 — Consolidation  
  输入：raw_memories.md + rollout_summaries/*
  执行：全局锁（consolidation-lock）+ consolidation 子 agent
  输出：memory_root/ 下的文件树：
    - MEMORY.md              (可 grep 的长期 handbook)
    - memory_summary.md      (始终进 system prompt，导航用)
    - raw_memories.md        (Phase 1 合并输入，Phase 2 消费)
    - skills/<skill-name>/   (可复用流程)
    - rollout_summaries/<rollout_slug>.md
```

**Consolidation prompt 的关键段落**（`core/templates/memories/consolidation.md`）：

```
Folder structure (under {{ memory_root }}/):

- memory_summary.md
  - Always loaded into the system prompt. Must remain informative and highly 
    navigational, but still discriminative enough to guide retrieval.
- MEMORY.md
  - Handbook entries. Used to grep for keywords; aggregated insights from 
    rollouts; pointers to rollout summaries if certain past rollouts are 
    very relevant.
- raw_memories.md
  - Temporary file: merged raw memories from Phase 1. Input for Phase 2.
- skills/<skill-name>/
  - Reusable procedures. Entrypoint: SKILL.md; may include scripts/, 
    templates/, examples/.
- rollout_summaries/<rollout_slug>.md
```

**与 CC Dream 对比**：


| 维度   | Codex memory pipeline                                        | CC Dream                              |
| ---- | ------------------------------------------------------------ | ------------------------------------- |
| 触发   | **启动时**（后台异步）                                                | **每轮对话结束**（stop hook fire-and-forget） |
| 阶段数  | 2（extract + consolidate）                                     | 4（orient/gather/consolidate/prune）    |
| 执行者  | Phase 1 直接调模型；Phase 2 子 agent                                | fork 子 agent                          |
| 输入   | rollout DB                                                   | 现有 memory + 多 session transcript      |
| 产出   | MEMORY.md + memory_summary.md + skills/ + rollout_summaries/ | MEMORY.md + topic 文件更新                |
| 并发控制 | 全局锁（consolidation-lock）                                      | `.consolidate-lock` 文件锁               |
| 目标   | 记忆巩固                                                         | 记忆巩固                                  |


**两者本质相同**：把**临时日志 → 结构化长期记忆**。**调度策略不同**：

- CC：每轮末尾检查阈值（"过去 24h + 5 sessions"）
- Codex：启动时一次性批处理

**Takeaway for our project**：

- ⭐⭐ Codex memory pipeline 是**可直接学习实现细节**的成熟方案
- `memory_summary.md` 放 system prompt（导航用）+ `MEMORY.md` 放 handbook（grep 用）**两级分层**比 CC 单 MEMORY.md 更合理
- `rollout_summaries/` 按 slug 归档历史会话摘要——这是我们 EventStore 已有素材的自然演化
- 启动时 vs 每轮触发各有利弊；秘书场景下 **每轮触发更及时**（接到重要消息后立刻记住）

### 4.4 Memory Citation（协议级结构化引用）

```rust
// protocol/src/memory_citation.rs (paraphrased)
struct MemoryCitation {
    path: String,
    lines: Option<(usize, usize)>,
    note: Option<String>,
    rollout_ids: Vec<String>,
}
```

assistant 消息可携带**对记忆文件的结构化引用**，UI/审计/回放都能定位来源。

**Takeaway**：⭐ Memory citation 是**协议级**而非字符串级——可追溯，可验证。linnsec 的记忆系统应该在第一版就加这个。

### 4.5 Compact（本地 + 远端两套）

#### 本地 compact

- 触发：`/compact` 手动 + pre-turn / mid-turn 自动（`auto_compact_token_limit`）
- 模板 (`core/templates/compact/prompt.md`，**全文**)：

```
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary 
for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly 
continue the work.
```

- Prefix 标记让后续 LLM 识别（`core/templates/compact/summary_prefix.md`）：

```
Another language model started to solve this problem and produced a summary 
of its thinking process. You also have access to the state of the tools that 
were used by that language model. Use this to build on the work that has 
already been done and avoid duplicating work. Here is the summary produced 
by the other language model, use the information in this summary to assist 
with your own analysis:
```

#### Remote compact（重要差异）

`compact_remote.rs`：**调用 OpenAI/Azure Responses 的 Compact endpoint**（供应商提供的 transcript 压缩 API），**不是另一台机器的 compact**。

```rust
// client.rs:421-493
/// Compacts the current conversation history using the Compact endpoint.
/// This is a unary call (no streaming) that returns a new list of
/// `ResponseItem`s representing the compacted transcript.
pub async fn compact_conversation_history(/* ... */) -> Result<Vec<ResponseItem>>
```

决策点：`should_use_remote_compact_task` → `provider.supports_remote_compaction()`。

**Takeaway**：⭐

- **本地 LLM-summary** + **供应商 API compaction** 双轨，按 provider 选择
- 我们也可以：如果 OpenAI/Anthropic 都开放 compact API 就用之，否则降级到本地 summary
- 对 linnsec 而言，自动 compact 对常驻会话**必要**（否则几天后 token 爆掉）

### 4.6 Skills 系统

- **载体**：SKILL.md + 可选 scripts/templates/examples
- **扫描**：`core-skills` 扫描多个 skill_roots（含 `CODEX_HOME/skills/.system` 嵌入样本）
- **触发**：`$skill` 提及 + explicit enable
- **注入**：`SkillInstructions` → `ResponseItem::Message` user + `<skill>` 标签包裹：

```
<skill>
<name>imagegen</name>
<path>/path/to/skill.md</path>
... SKILL.md 内容 ...
</skill>
```

- **MCP 依赖**：`mcp_skill_dependencies.rs` 在 skill 声明 MCP 依赖时提示安装缺失 server

**对比 CC**：CC 用 TS-inlined Markdown + `SkillTool` fork 子代理；Codex 用磁盘 SKILL.md + 提及触发 user 消息注入。**实现机制不同，心智模型相同**。

**Takeaway**：skills 是磁盘文件而非 bundle-时字符串——**便于用户编辑 + 版本控制**。

### 4.7 Contextual User Message（注入与用户消息的边界）

`core/src/contextual_user_message.rs`：

**片段类型**：AGENTS.md / environment XML / skill / shell command / turn aborted / `<subagent_notification>` 等——**都是 user 角色消息但有明确边界标记**，便于：

- 过滤（memory extraction 跳过 AGENTS.md + skill 片段）
- UI 展示（"用户实际说的" vs "系统注入的"）
- 审计

**Takeaway**：⭐ 用可解析边界（标签 / 约定前缀）区分**真用户话 vs 系统注入**，是 long-session agent 的必备能力。我们的 EventStore 已经有类似概念（event type），但**消息层内部也需要这种边界**。

### 4.8 Connectors（**不是** 通道，是 ChatGPT Apps）

`connectors/` + `core/src/connectors.rs`：

- **含义**：ChatGPT Apps 目录 + 当前用户可访问的 connector 列表
- `accessible.rs` —— 从 MCP 工具元数据聚合 AppInfo
- `filter.rs` —— 按产品策略过滤 connector id
- `merge.rs` —— 目录与 accessible 合并
- `metadata.rs` —— 安装 URL、排序

**与 IDE bridge、channel、通道完全无关**。是"应用目录/能力发现"。

**Takeaway**：⚠️ 命名混淆。secretary/03 的 "channel adapter" 框架**不应该叫 connectors**，否则会被误认为与 ChatGPT Apps 生态有关。

---

## 5. 工具框架 & Code Mode

### 5.1 分层工具类型系统

```
ToolDefinition (metadata)     在 tools/src/tool_definition.rs
    ↓ 由 ToolRegistryPlan 路由
ToolSpec (API 形状)           枚举: Function / Namespace / ToolSearch / LocalShell / WebSearch / Custom
    ↓ 序列化
ResponsesApiTool (API JSON)   在 tools/src/responses_api.rs
```

```rust
// tools/src/tool_definition.rs:4-13
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: JsonSchema,
    pub output_schema: Option<JsonValue>,
    pub defer_loading: bool,
}
```

**对比 CC**：CC 的 `Tool.ts` 巨型联合类型 vs Codex 分层枚举。Codex **完胜**。

### 5.2 Tool Registry Plan（声明式 + 运行时参数）

```rust
// tools/src/tool_registry_plan.rs:69+
pub fn build_tool_registry_plan(
    config: &ToolsConfig,
    params: ToolRegistryPlanParams<'_>,
) -> ToolRegistryPlan {
    let mut plan = ToolRegistryPlan::new();
    // ...
    if config.code_mode_enabled {
        let nested_plan = build_tool_registry_plan(/* 递归 */);
        // 注入 code_mode_exec / code_mode_wait handler
    }
    // ... shell, mcp resources, tool_search, mcp namespaces, dynamic_tools ...
}
```

**关键创新**：

- 输出 = **(specs 给模型, handlers ToolName→ToolHandlerKind)** 的不可变快照
- Code mode 通过**递归 plan** 把嵌套工具与外层 exec 解耦
- 强类型穷尽 match 而非巨型 TS 联合

**Takeaway**：⭐ Tool registry as plan（纯数据）比 CC 的 assembleToolPool 可测试、可复现。

### 5.3 Tool Search + Tool Suggest（两阶段发现）

- `tool_search` = **在已 deferred 的 MCP/dynamic tool 元数据里检索**（与 CC 的 ToolSearchTool 同构）
- `tool_suggest` = **建议用户安装缺失的 connector/plugin**，走 MCP elicitation（面向产品流程）

**对比 CC**：CC 只有 ToolSearch 做检索。Codex 把"检索"和"建议安装"分离，更精确。

### 5.4 Code Mode（V8 编排） vs JS REPL（Node）

**关键文档** (`docs/js_repl.md`)：

> `js_repl` runs JavaScript in a persistent Node-backed kernel with top-level `await`.
>
> `codex.tool(name, args?)`: executes a normal Codex tool call from inside 
> `js_repl` (including shell tools like `shell` / `shell_command` when available).

**Code mode 工具 description**（`code-mode/src/description.rs:10-24`，**verbatim**）：

```
const CODE_MODE_ONLY_PREFACE: &str =
    "Use `exec/wait` tool to run all other tools, do not attempt to use any other tools directly";
const EXEC_DESCRIPTION_TEMPLATE: &str = r#"Run JavaScript code to orchestrate/compose tool calls
- Evaluates the provided JavaScript code in a fresh V8 isolate as an async module.
- All nested tools are available on the global `tools` object, for example 
  `await tools.exec_command(...)`. Tool names are exposed as normalized JavaScript 
  identifiers, for example `await tools.mcp__ologs__get_profile(...)`.
- Nested tool methods take either a string or an object as their input argument.
- Nested tools return either an object or a string, based on the description.
- Runs raw JavaScript -- no Node, no file system, no network access, no console.
```

**两条代码执行路线对比**：


| 维度      | Code mode (V8)         | JS REPL (Node)              |
| ------- | ---------------------- | --------------------------- |
| 运行时     | V8 isolate，新建/销毁       | Node 进程，持久                  |
| FS 访问   | ❌ 无                    | ✅ 有                         |
| 网络      | ❌ 无                    | ✅ 有（受沙箱管）                   |
| Console | ❌ 无                    | ✅ 有                         |
| npm 模块  | ❌ 无                    | ✅ 有                         |
| 工具调用    | 通过 `tools.`* 全局桥到宿主    | 通过 `codex.tool(name, args)` |
| 用途      | **多工具编排 + 状态 + yield** | **复杂脚本 / 调试 / 数据处理**        |


**与 Anthropic code execution / MCP code mode 对比**：

- Anthropic：单一远程容器执行工具
- MCP code mode（规范向）：受控环境 + 受限 API
- Codex：**两轨并存**，粒度更细

**v8-poc crate 实质**：标记为 *"proof-of-concept crate reserved for future V8 experiments"*。生产 code-mode 在 `code-mode/` 已落地。

**Takeaway for our project**：

- ⭐ Code mode 本质是 **"带 yield 的 tool-orchestration DSL"**，不是替代 function calling
- 对 linnsec 来说：**暂时不需要**。秘书场景的工具调用是线性对话式，不是"多工具并行编排一大段逻辑"
- 但长远（12-24 月）可能有用：当秘书调用 Linnya + Cursor + 邮件工具需要复杂组合时，code mode 比 ReAct 风格高效

### 5.5 MCP 集成（双向）

**Codex 作为 MCP server** (`mcp-server/` 暴露 `codex` / `codex-reply` 工具)：

```
codex          — 启动新会话 (prompt, approval_policy, sandbox, ...)
codex-reply    — 续写会话
```

其它 agent（包括别的 Codex 实例）可以通过 MCP 调用 Codex。

**Codex 消费外部 MCP** (`codex-mcp/` + `rmcp-client/`)：

- 每 server 一个 `RmcpClient`
- 聚合工具名、处理 elicitation、启动失败事件
- 审批：`mcp_tool_approval_templates.rs` 加载 JSON 模板（`consequential_tool_message_templates.json` schema v4）按 `connector_id + server_name + tool_title` 匹配

**Takeaway**：⭐ **In-process MCP client + 对外 MCP server** 是 Codex 的能力互操作基石——相比 CC 这套更成熟。

---

## 6. 权限 / 沙箱 / 策略（重量级）

### 6.1 沙箱模型（三平台）

真相在 `codex-rs/core/README.md`（docs/sandbox.md 仅外链）：


| 平台      | 机制                                                   | 细节                           |
| ------- | ---------------------------------------------------- | ---------------------------- |
| macOS   | **Seatbelt** (`/usr/bin/sandbox-exec`)               | 工作区写策略，对 `.git`/`.codex` 等只读 |
| Linux   | **bubblewrap + seccomp** (新) / **Landlock** (legacy) | split filesystem policy 语义切换 |
| Windows | **elevated / restricted-token** 两套后端                 | 与 legacy SandboxPolicy 兼容    |


**网络控制**：进程环境变量 `CODEX_SANDBOX_NETWORK_DISABLED=1`，被 AGENTS.md 引用——脚本可检测。

`CODEX_SANDBOX=seatbelt` 用于嵌套测试场景的早退出。

### 6.2 Execpolicy（Starlark DSL！）

`execpolicy/` 用 **Starlark** (Python-like) 写执行规则：

```python
# 示意（非仓库代码）
define_program(
    name = "ls",
    arguments = [ ... ],
    decision = "allow"
)
```

- 老版 `execpolicy-legacy`：按 `execv` 参数做细粒度分类（safe/match/forbidden/unverified），`define_program`
- 新版 `execpolicy`：**前缀规则引擎**（prefix rules + network rules），更可扩展

**评估输出**：`Evaluation::Decision` = allow / 需审批 / deny，与 `AskForApproval`、sandbox 批准、`blocking_append_allow_prefix_rule` 等联动。

**Takeaway**：⭐⭐

- **把策略规则做成独立 DSL** 是企业级 agent 的分水岭
- 我们短期不需要上 Starlark，但 linnsec 的 permission 系统最终应该是**声明式规则文件**，不是硬编码
- `execpolicy/README.md` 关于两代演进的说明很值得一读

### 6.3 Guardian（独立小模型做审批）

`core/src/guardian/` —— 在 `on-request` 类审批上，**用独立小模型自动决定 allow/deny**：

```
流程：
  压缩当前 transcript
    ↓
  调用专用模型（如 codex-auto-review）
    ↓
  要求严格 JSON 输出 `GuardianAssessment`
    { risk, user_authorization, outcome }
    ↓
  失败（超时/坏 JSON）→ 关闭（fail-closed）
    ↓
  成功 → 直接批准/拒绝，无需骚扰用户
```

**Takeaway for our project**：⭐⭐⭐

- **策略 LLM 与工作 LLM 分离**是非常聪明的分层
- 适合高频低风险决策（"这条 bash 命令是否安全"）
- linnsec 可以用**小模型 + 严格 JSON** 做自动审批，减少秘书打扰主人
- **必须 fail-closed**（出错时升级到人类，而非静默放行）

### 6.4 权限模式 & Approvals

相比 CC 的 5 种 permission mode 状态机，Codex 把决策拆到多条路径：

- `exec_policy`（命令前缀）
- `approvals` protocol（`AskForApproval` 变体）
- `Guardian`（自动化审批）
- `request_user_input` 工具（结构化问卷）
- `shell-escalation`（sudo 类提权独立 IPC）

**更组合化，但也更分散**。CC 的状态机更集中易读。

### 6.5 Hooks（Claude 兼容）

`hooks/src/engine/` —— **复用 Claude Code 的 hook 协议**（！）：

- 事件：`PreToolUse` / `PostToolUse` / `PermissionRequest` / `SessionStart` / `UserPromptSubmit` / `Stop`
- 实现：shell 命令 + JSON 响应（与 CC 一致）
- 额外：`preview_session_start`、discovery、schema validation、`HookRunSummary` 协议级统计

**Takeaway**：⭐ **Hooks 作为事实标准协议**——CC 定义，Codex 兼容。我们的 hook 设计应该采用这个协议（`PreToolUse` 等事件名 + JSON 响应 schema），立即获得生态兼容。

### 6.6 Shell Escalation（独立提权通道）

`shell-escalation/` —— 不是 sandbox、也不是 execpolicy，是**第三条独立通道**：

- Unix：`EscalateServer` + `ExecParams` + `main_execve_wrapper`
- sudo 在 banned prefix suggestions 里（不让模型自决 sudo）
- 走**专门的 IPC/socket 协议**

**Takeaway**：⚠️ 对 linnsec 可能不必要。秘书一般不需要 sudo，排除掉更安全。

### 6.7 Apply Patch（V4A 自定义格式）

```
** Begin Patch
*** Update File: path/to/file.rs
@@ @@ context
- old line
+ new line
*** End Patch
** End Patch
```

- Lark grammar parse (`apply-patch/src/parser.rs`)
- 通过 `arg0` 自调用：`codex --codex-run-as-apply-patch`
- **专用 grammar 让 LLM 犯错时可定位，代价是不兼容通用 diff 工具**

---

## 7. 进程模型 / Daemon / 持久化 / 协议

### 7.1 进程形态

Codex 的**多入口 + 统一协议**设计：

```
$ codex                          → TUI（默认）
$ codex exec                     → 非交互单次 (用 InProcessAppServerClient)
$ codex review                   → code review 模式
$ codex mcp-server               → 作为 MCP server (stdio)
$ codex app-server               → 独立 daemon (stdio/ws/off)
$ codex cloud [exec/list/...]    → ChatGPT cloud tasks 客户端
$ codex exec-server              → 长期运行的执行服务（沙箱 FS）
$ codex stdio-to-uds             → socat-like 桥（stdio ↔ UDS）
$ codex login/logout/mcp/plugin  → 维护子命令
```

**关键洞察**：`**app-server` 是一等公民**，不是 optional daemon。VS Code 扩展等 rich UI 通过它交互。

### 7.2 App-Server 传输层

```rust
// AppServerTransport 三种
enum AppServerTransport {
    Stdio,                              // NDJSON/JSONL，单客户端生命周期
    WebSocket { bind_address: String }, // 多客户端，带 /healthz /readyz
    Off,                                // 不本地监听（但可仍有 remote_control）
}
```

- **Remote Control**：即使 `listen=off`，启用 `Feature::RemoteControl` 时可向 ChatGPT 侧建立并行 WS 控制面
- **多客户端路由**：`ThreadStateManager` 维护 `ThreadId → {ConnectionId}` 订阅集合，事件广播/定向

### 7.3 协议线格式

**⚠️ 不是严格 JSON-RPC 2.0**：

```rust
// app-server-protocol/src/jsonrpc_lite.rs:1-4
//! We do not do true JSON-RPC 2.0, as we neither send nor expect the
//! "jsonrpc": "2.0" field.
```

**三类消息**：

- `ClientRequest` (客户端→服务器，带 id)
- `ServerNotification` (服务器→客户端，无 id)
- `**ServerRequest`**（服务器→客户端请求，客户端必须回 Response）——**用于审批、elicitation、dynamic tool**

**内部 vs 外部协议分层**：

```
内部 (protocol crate)         外部 (app-server-protocol crate)
  Op / EventMsg         ↔       thread/* + turn/* + item/* JSON-RPC
   (SQ/EQ 模型)                    (VS Code 等消费)
```

### 7.4 Thread 状态机

```rust
// app-server-protocol/src/protocol/v2.rs:3360+
pub enum ThreadStatus {
    NotLoaded,
    Idle,
    SystemError,
    Active {
        active_flags: Vec<ThreadActiveFlag>,
    },
}

pub enum ThreadActiveFlag {
    WaitingOnApproval,
    WaitingOnUserInput,
}
```

简单实用。**单 Session 单 Task**（文档约束），并行任务用多个线程。

### 7.5 Rollout（持久化子系统）

```
~/.codex/sessions/rollout-{ts}-{thread_id}.jsonl   ← 权威磁带（JSONL）
~/.codex/session_index.jsonl                       ← append-only 名索引
~/.codex/state_*_v*.sqlite                         ← SQLite (列表加速)
```

**关键创新：`EventPersistenceMode::{Limited, Extended}`**（`rollout/policy.rs`）

- Limited（默认）：**不持久化流式 delta 等噪声事件**
- Extended：更多事件（如 `ExecCommandEnd`）
- 控制粒度在策略层而非硬编码

**对比 CC**：CC 的 JSONL 是**全量 append-only**；Codex 显式区分"什么值得落盘"。**Codex 胜出**。

### 7.6 ThreadStore（trait 已画，remote 未完成）

```rust
// thread-store/src/store.rs:18-65
#[async_trait]
pub trait ThreadStore: Send + Sync {
    async fn create_thread(&self, ...) -> ThreadStoreResult<Box<dyn ThreadRecorder>>;
    async fn resume_thread_recorder(&self, ...) -> ThreadStoreResult<Box<dyn ThreadRecorder>>;
    async fn append_items(&self, ...) -> ThreadStoreResult<()>;
    async fn load_history(&self, ...) -> ThreadStoreResult<StoredThreadHistory>;
    async fn read_thread(&self, ...) -> ThreadStoreResult<StoredThread>;
    async fn list_threads(&self, ...) -> ThreadStoreResult<ThreadPage>;
}
```

- `LocalThreadStore` —— 基于 `RolloutConfig`，大部分实现但 `create_thread`/`recorder` 仍是 `unsupported`（主路径绕 core/rollout 直写）
- `RemoteThreadStore` —— **gRPC 客户端**，但**只 `list_threads` 实现**，其它 stub

**Takeaway**：⭐ **trait-based 存储边界 + 多后端**是正确方向，但 Codex 这块也还在演进中。我们的 Checkpointer/EventStore 可以照这个方向设计（接口先行，实现渐进）。

### 7.7 Connectors（ChatGPT Apps 合并，**不是**通道）

已在 §4.8 说明。**命名陷阱**：与 "channel adapter" 无关。

### 7.8 认证链

```
~/.codex/auth.json          ← 主文件
  ├── auth_mode              (apiKey | chatgpt | chatgptDeviceCode)
  ├── OPENAI_API_KEY
  ├── tokens                 (ChatGPT OAuth refresh 等)
  ├── workspace_id
  └── agent_identity         (workspace + 密钥)

keyring-store               ← OS keyring 抽象
secrets                     ← 命名密钥 (SecretName 全大写 + SecretScope)
```

ChatGPT OAuth + API key fallback + **device code**（无浏览器环境友好）。

### 7.9 Realtime WebRTC（语音）

`realtime-webrtc/`（**macOS only**）：

- libwebrtc + PeerConnection
- SDP offer/answer via app-server 协议 `thread/realtime/start` + `thread/realtime/sdp`
- 音频轨 + `oai-events` data channel
- **Realtime 事件不持久化到 ThreadItem 历史**（ephemeral transport events）

**对比 CC 的 voice**：CC 用 `voice_stream` WS（简单）；Codex 用真正的 WebRTC 栈（复杂但正确）。

**Takeaway**：⚠️ 对 linnsec 太重。秘书场景用 CC 的 push-to-talk WS 即可，WebRTC 留给"面对面对话"的远期功能。

### 7.10 Multi-thread 隔离

- `ThreadManager: HashMap<ThreadId, Arc<CodexThread>>` 进程内多线程并存
- 隔离粒度：对话状态按 ThreadId 分片；配置/MCP/skills/plugins manager 共享
- **无**每线程 CPU 配额 / 租户隔离
- 文档明确 "单 Session 单 Task"；并行任务 = 多个 thread

**Takeaway**：**单用户多任务**架构。多租户 SaaS 需要重做。

---

## 8. 工程化质量评估


| 维度     | Codex                         | Claude Code           | 谁更强       |
| ------ | ----------------------------- | --------------------- | --------- |
| 架构清晰度  | ⭐⭐ crate-per-concern          | ⭐ 顶层分层清晰              | **Codex** |
| 模块化纪律  | ⭐⭐⭐ <500 LoC/模块强制             | ❌ 46K 行单文件            | **Codex** |
| 协议设计   | ⭐⭐ 协议独立 crate + schema 生成     | ⭐⭐ 控制面/内容面分离          | 并列        |
| 类型系统利用 | ⭐⭐ 穷尽 match + trait           | N/A (TypeScript)      | 不可比       |
| 测试覆盖   | ⭐⭐ 大量 `_tests.rs` 邻居文件        | ?                     | **Codex** |
| 代码质量   | ⭐⭐ 注释准确、命名统一                  | ⭐⭐ 同样高                | 并列        |
| 协议稳定性  | ⭐⭐ experimental + opt-out 机制  | ⭐ SDK control schemas | **Codex** |
| 文档     | ⭐⭐ 自带 architecture docs       | ⭐ 注释解释 why            | **Codex** |
| 性能     | ⭐⭐ Rust                       | ⭐⭐ 并行预取               | 不可比       |
| 可维护性   | ⭐⭐⭐ 模块化纪律强制                   | ⭐ feature flag 矩阵偏重   | **Codex** |
| 未完成留白  | ⚠️ ThreadStore remote 多为 stub | 似乎完成度更高               | **CC**    |


**综合**：Codex 工程化水平整体 > CC，但 CC 更"成品"。学习架构推荐 Codex，学习实际产品交付 CC。

---

## 9. 对我们的启发清单（按 topic 归档）

### → engine/01-async-runs-and-handles

- ✅ **双层循环**（会话 Op channel + turn stream loop）—— 比单 generator 更 Rust-native，但图引擎也天然对应（调度器 + 节点执行）
- ✅ **Delegate bridge**：子 agent 审批上浮到父 Session UI，值得借鉴
- ✅ `**agent_tool` vs `agent_job_tool` 分工**：通用协作 vs 批处理，linnsec 先只要前者
- ✅ `**<subagent_notification>` XML 注入** —— 与 CC `<task-notification>` 同源，进一步验证方案 A
- ⚠️ AgentIdentity（云）vs AgentPath（编排）两种 ID 应分开，不要混

### → engine/02-session-and-tenancy

- ✅ `**ThreadId` (UUID v7) + `AgentPath` (`/root/...`) + `AgentRegistry`** 三件套
- ✅ Thread 状态机：`NotLoaded / Idle / SystemError / Active{flags}`，简单实用
- ✅ "单 Session 单 Task" 的约束在协议文档里明确
- ⚠️ 但 Codex 的 session ≠ IM peer/thread，仍需自己设计 session-key

### → engine/03-memory-port（重点）

- ⭐⭐ **ContextManager + reference_context_item + diff 注入**——**我们应该直接抄**
- ⭐⭐ **Memory 2-phase pipeline**（extract + consolidate，启动时触发）—— 与 CC Dream 互补
- ⭐ **memory_summary.md（system prompt）+ MEMORY.md（grep handbook）+ rollout_summaries/** 两级分层比 CC 单 MEMORY.md 更好
- ⭐ **Memory citation 协议** —— 第一版就加
- ⭐ **Contextual user 片段边界标记** —— 长会话必备
- ✅ AGENTS.md 从 cwd 向上扫 + home override + 串联（不覆盖）

### → engine/04-long-running-tool

- ✅ Codex 没有 kernel-level pause；长任务 = 普通工具 + session state（与 CC 同）
- ✅ `**wait` 工具（code mode）** = 协作式多轮 yield 输出——值得借鉴

### → engine/05-external-agent-tool-protocol

- ⭐ **分层类型系统**：ToolDefinition / ToolSpec / ResponsesApiTool
- ⭐ **ToolRegistryPlan** = specs + handlers 的纯数据快照
- ✅ Tool search + Tool suggest 两阶段发现
- ✅ MCP 双向（IS-A server + HAS-A client）
- ⚠️ `external_agent_config` 指"从 Claude 迁移"，命名有歧义

### → engine/06-checkpointer-and-persistence

- ⭐⭐ **三层持久化**：JSONL rollout + SQLite state_db + session_index.jsonl
- ⭐ `**EventPersistenceMode::{Limited, Extended}`** 显式区分流式 delta 噪声
- ⭐ `**ThreadStore` trait + local/remote 后端** 模式（虽然 remote 尚未落地）
- ✅ 路径策略：`~/.codex/sessions/rollout-{ts}-{thread_id}.jsonl`

### → engine/07-public-api-and-boundary

- ⭐⭐ `**app-server-protocol` 独立 crate** + schema 生成 + `experimental_api.rs` 门控
- ⭐ **Initialize/capabilities/opt-out** 三件套
- ⭐ **server→client 请求**（审批、elicitation）—— MCP 式设计
- ⚠️ `jsonrpc_lite` 省略 `"jsonrpc": "2.0"` 字段——**我们应该严格遵守 JSON-RPC 2.0**

### → engine/08-cross-cutting

- ⭐ **Guardian** = 独立小模型做结构化审批——跨横切的最佳样本
- ✅ Hook JSON 协议（复用 CC 设计）
- ✅ telemetry/analytics 独立 crate

### → secretary/02-gateway-daemon

- ⭐⭐ `**codex app-server` 是生产级 daemon** 的范本（stdio + ws + remote_control）
- ⭐ 背压：ws 满断、stdio 阻塞
- ⭐ `in_process.rs` 嵌入模式（与网络模式共用 MessageProcessor）

### → secretary/03-channel-adapter-framework

- ⚠️ Codex 的 `connectors` **不是**通道抽象，是 ChatGPT Apps 目录
- ✅ 传输层抽象（stdio/ws/off）值得学习
- ⚠️ Codex 没有类似 TG/WeChat 多 IM 通道的统一抽象——说明**这部分需要我们自己设计**

### → secretary/04-dm-security-and-pairing

- ⭐ `workspace_id` + `agent_identity` + device code OAuth 的分层
- ⭐ `keyring-store` + `secrets` 分离
- ✅ Trusted device token 模式

### → secretary/05-scheduler-subsystem

- ⚠️ Codex 没有 CLI 内置 cron —— 它靠 cloud-tasks 做云端调度
- ✅ linnsec 的 cron 应该参考 CC 的 in-process scheduler，而非 Codex

### → secretary/06-memory-backends

- ⭐⭐ Codex memory pipeline 直接可抄
- ⭐ 两级文件（`memory_summary.md` + `MEMORY.md` + `rollout_summaries/`）
- ⭐ Phase 1/2 拆分（extract vs consolidate）
- ⭐ 全局锁控制并发

### → secretary/07-skills-and-workspace

- ⭐ SKILL.md + 提及触发 + `<skill>` user 消息注入
- ⭐ 样本：`skills/src/assets/samples/*/SKILL.md`（imagegen 等）
- ⭐ MCP 依赖声明（`mcp_skill_dependencies`）

### → secretary/08-node-protocol

- ⭐ **app-server JSON-RPC 契约** 是 node protocol 的直接参考
- ⭐ Server→client 请求（审批、elicitation）
- ⭐ Opt-out notification by method

### → secretary/09-sandbox-and-permission

- ⭐⭐⭐ **Execpolicy DSL（Starlark）** —— 声明式规则文件
- ⭐⭐⭐ **Guardian 独立审批 LLM** —— 自动决策 + fail-closed
- ⭐⭐ 三平台沙箱（Seatbelt / bwrap+seccomp / Windows restricted-token）
- ⭐ `CODEX_SANDBOX_NETWORK_DISABLED` env var 协议
- ⭐ Shell escalation 独立 IPC（但 linnsec 可能不需要）

### → secretary/10-linnya-integration

- ⭐ Codex 作为 MCP server 暴露 `codex` / `codex-reply` —— 给了 linnsec 调用 Codex 的直接样本

### → secretary/11-external-agent-tools

- ⭐ 命令 `codex exec` 可无头运行任务（`--json` JSONL 事件）—— linnsec 可直接 spawn
- ⭐ Cloud-tasks：`Exec/Status/List/Apply/Diff` API 设计是"调 Codex Web"的样本
- ⭐ Apply-patch V4A 格式（如果 linnsec 需要把 Codex 改动 apply 回本地）

### → secretary/12-voice-canvas-future

- ⚠️ WebRTC 对 linnsec 太重
- ✅ Realtime 事件**不进 ThreadItem 持久化**（ephemeral）—— 语音消息的持久化策略参考

### → secretary/13-deployment-and-ops

- ⭐ 子命令分流 + feature flag
- ⭐ 多入口单二进制（vs 多二进制）
- ⭐ keyring + secrets 分层

---

## 10. 最值得抄的 10 个具体设计（排序按借鉴难度从低到高）

1. **Guardian**（独立小模型做审批）—— 几百行代码，立即减少用户打扰
2. **Memory citation 协议**（`{path, lines, note, rollout_ids}`）—— 一个类型定义的事
3. `**<subagent_notification>` XML 边界标记** —— 协议约定而已
4. **SKILL.md + `$skill` 提及 + `<skill>` 注入** —— 文件扫描 + 提示词
5. `**EventPersistenceMode::{Limited, Extended}` 策略** —— 几个 match 分支
6. **Memory 2-phase pipeline**（extract + consolidate）—— 几百行 + 模板 prompt
7. **reference_context_item + diff 注入** —— ContextManager 重要演进
8. **App-server JSON-RPC 协议 + server→client 请求** —— 需要正确设计
9. **ToolRegistryPlan 纯数据构建** —— 需要 Rust 或等价类型系统
10. **Execpolicy DSL（Starlark）** —— 只在企业化时考虑

---

## 11. 不要抄的部分

1. `**jsonrpc_lite` 省略 `"jsonrpc": "2.0"` 字段** —— 我们应严格遵守 JSON-RPC 2.0
2. **ChatGPT OAuth + connectors + cloud-tasks 绑定** —— OpenAI 独有
3. **Responses Compact endpoint** —— 供应商专属 API
4. **Starlark DSL**（短期内）—— 过重
5. **macOS-only WebRTC** —— 跨平台问题
6. `**external_agent_config` = 从 Claude 迁移** —— 命名含义和通用"外部 agent"不一致
7. `**hierarchical_agents_message.md` 文件名** —— 与内容不一致
8. **arg0 自调用多入口** —— Rust 特有 trick
9. **Windows 三套沙箱后端** —— 维护成本高
10. **Bazel + Cargo 双栈** —— 除非你们真需要 Bazel

---

## 12. Codex vs Claude Code 总对比表


| 维度        | Codex                                                           | Claude Code                            | 观察                 |
| --------- | --------------------------------------------------------------- | -------------------------------------- | ------------------ |
| 主循环       | Op channel + stream loop                                        | async generator + while(true)          | 语言决定形态；我们图引擎两者都 OK |
| 子代理       | `spawn_agent` + `wait_agent` (协作) / `spawn_agents_on_csv` (批处理) | 单 `AgentTool` + async/sync 分支          | **Codex 拆分更清晰**    |
| 子代理结果     | mailbox + `<subagent_notification>`                             | AppState.tasks + `<task-notification>` | 同源不同实现             |
| 身份        | ThreadId (UUID v7) + AgentPath 树                                | 依 CC session + taskId                  | **Codex 正式建模**     |
| 上下文管理     | **ContextManager + diff 注入**                                    | 每轮重拼 CLAUDE.md                         | **Codex 先进**       |
| AGENTS.md | 多路径串联 + home override                                           | AGENTS.md 相同文件协议                       | 同源                 |
| 记忆系统      | 启动时 2-phase pipeline                                            | 每轮末尾 Dream（4-phase）                    | **本质相同，调度不同**      |
| Memory 文件 | memory_summary.md + MEMORY.md + rollout_summaries/              | MEMORY.md + topic 文件                   | **Codex 两级分层**     |
| Compact   | 本地 + 供应商 API                                                    | 本地 LLM-summary                         | Codex 多一条路         |
| Tool 建模   | ToolDefinition / ToolSpec / ResponsesApiTool                    | 巨型 Tool 联合                             | **Codex 完胜**       |
| Tool 发现   | tool_search + tool_suggest (生态引导)                               | 单 ToolSearchTool                       | Codex 多一条          |
| 代码执行      | V8 code mode + Node js_repl 双轨                                  | Bash + 文件工具为主                          | **Codex 前瞻**       |
| 沙箱        | Seatbelt + bwrap + Windows 三套 + execpolicy DSL                  | 相对轻                                    | **Codex 重得多**      |
| 权限自动化     | **Guardian 小模型**                                                | 5 模式状态机                                | **Codex 新颖**       |
| Hooks     | Claude 兼容协议                                                     | 定义协议                                   | **Codex 采用了 CC**   |
| 持久化       | JSONL + SQLite + session_index                                  | 纯 JSONL                                | **Codex 分层**       |
| Daemon    | app-server 一等公民                                                 | 可选 supervisor+worker                   | **Codex 更正式**      |
| 协议        | JSON-RPC-like + server→client 请求                                | control vs content 分离                  | 同类                 |
| Voice     | WebRTC (macOS)                                                  | WS push-to-talk                        | CC 轻               |
| 外部 agent  | MCP 双向 + cloud-tasks                                            | bridge + remote                        | **Codex MCP 更成熟**  |
| 代码组织      | **强制 <500 LoC/模块**                                              | 46K 行单文件                               | **Codex 完胜**       |
| 未完成度      | ThreadStore remote 是 stub                                       | 似乎完成度更高                                | CC 略胜              |


---

## 13. 后续深挖待办

如果某 topic 工作时需要更深，回头精读：

- `codex-rs/core/src/guardian/mod.rs` + `guardian/policy.md` —— 设计 secretary/09 时
- `codex-rs/core/src/context_manager/updates.rs` —— 设计 engine/02/03 时（diff 注入细节）
- `codex-rs/core/src/memories/` 完整代码 + `templates/memories/consolidation.md` —— 设计 memory 时
- `codex-rs/rollout/src/policy.rs` —— 设计 Checkpointer 持久化策略时
- `codex-rs/app-server-protocol/src/protocol/v2.rs` —— 设计 linnsec node protocol 时
- `codex-rs/execpolicy/src/` + `docs/execpolicy.md` —— 如果 linnsec 企业化时
- `codex-rs/tools/src/tool_registry_plan.rs` —— 改进我们的 tool registry 时
- `codex-rs/core/src/tools/handlers/multi_agents_v2/` —— 设计 agent_tool 对应物时
- `codex-rs/hooks/src/engine/` —— 设计 secretary hooks 时（采用 Claude 协议）
- `codex-rs/docs/protocol_v1.md` + `app-server/README.md` —— 设计 engine/07 public API 时
- `codex-rs/core/templates/agents/orchestrator.md` —— 写 system prompt 时（多 agent 协作模板）
