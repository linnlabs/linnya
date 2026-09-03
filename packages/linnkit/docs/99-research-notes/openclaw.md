# OpenClaw

> 调研日期：2026-04-20  
> 调研深度：中（架构层 + 关键文件路径，未做逐行代码精读）  
> 质量评估：⚠️ AI 辅助 10 余天写出来的同类秘书产品，含大量低质量代码与多套并存 runtime；产品形态完整、设计意图清晰，但实现细节**不值得抄**  
> 借鉴边界：⚠️ **仅意图借鉴，不抄实现**

仓库位置（本机）：`<upstream-workspace>/openclaw/`（shallow clone）

---

## 1. 项目定位

- 个人 AI 秘书 daemon（"OpenClaw Gateway"），常驻本地或远程机
- 接 20+ IM 通道（WhatsApp / Telegram / Slack / Discord / Feishu / WeChat / iMessage / Matrix / IRC / ...）
- 支持语音唤醒（macOS/iOS）+ 持续语音（Android）
- Live Canvas（A2UI 协议 agent-driven UI）
- 子 agent 一等公民（`sessions_spawn` 异步派生）
- 持久化定时任务（cron）
- 长期记忆（文件式 + 向量式插件）
- 通过 ACP（Agent Client Protocol）调用外部 agent (Codex / Claude Code 等)
- Companion apps（macOS menu bar、iOS、Android 作为"node"）

跟我们 linnsec 目标产品形态**高度重合**——这是它最大的参考价值。

---

## 2. 顶层目录与代码组织


| 路径            | 角色                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------- |
| `src/`        | 核心：CLI、commands、Gateway、channels（核心实现）、agents（agent 循环 + 工具）、plugins（注册器）、infra、media、web 等 |
| `extensions/` | 116 个扩展子目录：channel/provider/memory/harness 各自插件化                                            |
| `packages/`   | 共享 package：`plugin-sdk`、`memory-host-sdk` 等                                                 |
| `apps/`       | 原生应用与共享 Kit（如 `apps/shared/OpenClawKit` Swift）                                              |
| `vendor/`     | 第三方规格/渲染器（`vendor/a2ui/` JSON schema + Lit renderer）                                        |
| `ui/`         | Web Control UI                                                                              |
| `docs/`       | 概念、参考、插件、通道等                                                                                |
| `skills/`     | npm 包内捆绑的 bundled skills                                                                    |


**核心 vs 适配器 vs 应用 vs UI** 分层：

- 核心：`src/`**
- 适配器：`extensions/*` + `src/plugin-sdk/*` + `src/plugins/*`
- 应用：`apps/*`
- UI：`ui/`

---

## 3. 核心架构主线

### 3.1 Gateway daemon

- HTTP + WebSocket 服务体在 `src/gateway/server.impl.ts`
- 经 `src/gateway/server.ts` 懒加载 `startGatewayServer`
- CLI 入口：`src/cli/gateway-cli/run.ts` 的 `runGatewayLoop`
- 通过 `openclaw onboard --install-daemon` 安装为 launchd（macOS）/ systemd user service
- **单一长期 Gateway 拥有所有通道会话**（`docs/concepts/architecture.md`）
- 控制端与 node 都通过 WebSocket 连接，**首帧必须 `connect`**
- **事件不重放**——简化服务器但把 gap 处理推给客户端

### 3.2 Agent 循环

- **不是 graph engine**，是 PI 嵌入式 ReAct loop
- 入口：Gateway RPC `agent` / `agent.wait` 或 CLI `agent`
- 调用链：`agentCommand` → `runEmbeddedPiAgent`（pi-agent-core / "Pi" 嵌入式运行时）
- 事件经 `subscribeEmbeddedPiSession` 映射为 `assistant` / `tool` / `lifecycle` 流
- **per-session 串行 run**，全局 lane 限制并发（`agents.defaults.maxConcurrent`）
- 通道队列模式：`steer` / `followup` / `collect`
- 文档：`docs/concepts/agent-loop.md`、`docs/concepts/queue.md`

### 3.3 Session model（**最值得借鉴的设计**）

- **session-key 是单一字符串**，编码所有路由维度
- 文件：`src/routing/session-key.ts`、`src/sessions/session-key-utils.ts`
- 形如 `agent:<agentId>:...`，含 cron / subagent / ACP 等前缀语义
- 有 `isCronSessionKey`、`isSubagentSessionKey` 等谓词
- 持久化到磁盘（JSON / JSONL），守护进程重启后会话仍在
- 路径：`~/.openclaw/agents/<agentId>/sessions/`（可通过 `session.store` 覆盖）
- "main session" vs 非 main：用 `resolveMainSessionAlias` / `DEFAULT_MAIN_KEY` 处理；**MEMORY.md 仅在 main session 加载**（隐私边界）

### 3.4 子 agent (`sessions_spawn`)

- 工具：`src/agents/tools/sessions-spawn-tool.ts`
- 两种 runtime：
  - `runtime: "subagent"` → `src/agents/subagent-spawn.ts` 的 `spawnSubagentDirect`
  - `runtime: "acp"` → `src/agents/acp-spawn.ts` 接外部 ACP harness
- **异步**：execute 立即返回 `{status: "accepted", childSessionKey, runId}`，不阻塞
- registry：`src/agents/subagent-registry.ts`（内存 + 持久化到盘）
- 父拿结果方式：**announce / push**，**禁止轮询** `sessions_list`
- 系统提示中明确教 LLM 不要轮询（`src/agents/subagent-system-prompt.ts`）
- 运维工具：`src/agents/tools/subagents-tool.ts`（list/kill/steer）
- Gateway 协议层：`agent.wait` 等待 run 结束

### 3.5 Cron

- 子系统：`src/cron/`**
  - `store.ts` ——JSON 持久化（默认 `~/.openclaw/cron/jobs.json`，`version: 1`）
  - `service/timer.ts` —— 定时器与 missed-job 逻辑
  - `service/state.ts` —— `missedJobStaggerMs` 等 catch-up 限流
  - `isolated-agent/run-executor.ts` —— **在隔离 agent session 跑 cron payload**
- **既是子系统也是工具**（`createCronTool` 由 `src/agents/openclaw-tools.ts` 引入）
- cron 命中时用**专用 cron session key**，**不污染** IM 会话
- 测试：`src/cron/service.restart-catchup.test.ts`、`timer.regression.test.ts`

### 3.6 通道

- 核心契约：`src/channels/plugins/types.core.ts`（`ChannelAgentTool`、`ChannelMessageToolDiscovery`、`dmAllowlist` 等）
- Plugin SDK：`src/plugin-sdk/channel-contract.ts`
- 各通道：`extensions/<channel>/`（telegram / slack / discord / matrix / whatsapp / ...）
- 各通道可向共享 `message` 工具贡献 schema 片段（`ChannelMessageToolSchemaContribution`）
- **入站流向**：通道插件 → `src/auto-reply/`** 路由 → session lane 队列 → `runEmbeddedPiAgent`
- **出站流向**：`message` 工具 + 通道适配器 + `src/infra/outbound/`**
- 硬规则：**外部聊天面不发送流式部分回复**（根 `AGENTS.md`）
- **DM 配对**：`docs/channels/pairing.md`，凭据存 `~/.openclaw/credentials/<channel>-pairing.json` 与 `<channel>-allowFrom.json`

### 3.7 外部 agent（ACP）

- ACP = Agent Client Protocol，用作外部 CLI agent 的统一接入协议
- 实现：`src/agents/acp-spawn.ts`、`src/acp/`**、`extensions/acpx`
- 文档：`docs/tools/acp-agents.md`
- Codex 走 `extensions/codex` + `app-server harness`（文档：`docs/plugins/codex-harness.md`）
- ChatGPT/Codex OAuth 凭据**直接读对方应用的本地文件**（如 `~/.codex/auth.json`），不自己管 auth
- 也支持 CLI Backends（纯文本回退，无完整 OpenClaw 工具）

### 3.8 Memory

- 概念文档：`docs/concepts/memory.md` / `memory-builtin.md` / `memory-qmd.md`
- 配置：`docs/reference/memory-config.md`
- **同时只能开一个 memory 插件**（`VISION.md` 明确）
- 插件：`extensions/memory-core` / `memory-lancedb` / `memory-wiki`
- 既有文件式 `MEMORY.md` 也有向量 `memory_search` / `memory_get` 工具
- 启动 bootstrap 时随 workspace 文件 + system prompt 一起组装

### 3.9 Skills

- 加载器：`src/agents/skills.ts`（`loadWorkspaceSkillEntries`、`buildWorkspaceSkillSnapshot`、`resolveSkillsPromptForRun`）
- AgentSkills 兼容，目录含 `SKILL.md`（YAML frontmatter + 说明）
- workspace 路径：`~/.openclaw/workspace/skills/<skill>/SKILL.md`
- **进入 prompt + slash command 发现**，**不**等同于 MCP tool
- 沙箱同步：`docs/tools/skills.md`
- 安装：ClawHub（`docs/tools/clawhub.md`）

### 3.10 Sandbox

- `agents.defaults.sandbox.mode: "non-main"` → 非主 session 跑 Docker 容器
- 验证策略：`src/agents/sandbox/validate-sandbox-security.ts`（禁止挂 docker.sock）
- workspace seed：`src/agents/sandbox/workspace.ts`
- `sessions_spawn` 支持 `sandbox: "inherit" | "require"`
- 默认 sandbox 允许 `bash, process, read, write, edit, sessions_list, sessions_history, sessions_send, sessions_spawn`；deny `browser, canvas, nodes, cron, discord, gateway`

### 3.11 Node（companion app 协议）

- Node = 手机/Mac 等以 `role: node` 连接同一 WebSocket 的客户端
- 声明 caps（`canvas.`* / `camera.*` / `screen.record` / `location.get`）
- Gateway invoke 这些能力
- 文档：`docs/concepts/architecture.md`
- 历史：`docs/gateway/bridge-protocol.md` 已废弃 TCP JSONL bridge，统一 WS

### 3.12 Voice

- macOS：`docs/platforms/mac/voicewake.md`
- `VoiceWakeRuntime` + `VoiceWakeForwarder` 转发到本地 / 远程 Gateway agent
- **wake engine 在 macOS 应用内**，不是 Gateway 内嵌
- Gateway 协议含 `TalkSpeak` / `TalkConfig`（`src/gateway/protocol/index.ts`）

### 3.13 Live Canvas (A2UI)

- vendor 规格：`vendor/a2ui/specification/`（JSON schema：server / client / 组件目录）
- 宿主路由：`src/canvas-host/a2ui.ts`
  - `/__openclaw__/a2ui`
  - `/__openclaw__/canvas`
  - `/__openclaw__/ws`
- bundled renderer：`a2ui/index.html` + `a2ui.bundle.js`
- 工具：`createCanvasTool`（`src/agents/openclaw-tools.ts`）

---

## 4. 工程化质量评估


| 维度       | 评估                                                                   |
| -------- | -------------------------------------------------------------------- |
| 架构清晰度    | ✅ 顶层分层清晰（Gateway / agents / channels / plugins / sandbox）            |
| 模块边界     | ⚠️ 多套 runtime 并存（PI / Codex harness / ACP / CLI backend）认知负担大        |
| 测试覆盖     | ⚠️ 部分模块有 vitest 测试，但覆盖不全                                             |
| 代码质量     | ⚠️ AI 辅助产出的痕迹明显：长函数、命名不一、重复结构、注释噪声多                                  |
| 协议稳定性    | ⚠️ 频繁出现兼容性 patch（如 `sessions-send-tool.a2a.ts` 等变体）                  |
| 文档质量     | ✅ 文档量很大且结构清晰，但 `docs/refactor/`* 和 `docs/.generated/*` 泄露了大量未消化的工程内幕 |
| 性能/扩展性考虑 | ⚠️ 缺乏明确的性能基准与压测                                                      |
| 可维护性     | ❌ 随着扩展矩阵扩张已经显出维护负担                                                   |


**结论**：架构和概念是好的，工程实现**绝对不要照抄**。

---

## 5. 对我们的启发清单

按 topic 归档（topic 文档创建时回头精读对应条目）：

### → engine/01-async-runs-and-handles

- `sessions_spawn` 立即返回 runId、不阻塞
- `agent.wait` 协议层显式等待
- `subagent-registry` 持久化，跨重启恢复
- 完成靠 announce/push，**禁止轮询**
- 父子结果传递走"系统注入下一轮 user message"

### → engine/02-session-and-tenancy

- session-key 作为**单一字符串**编码所有路由维度（强烈推荐这个设计）
- session-key 谓词（`isCronSessionKey` 等）
- main session vs 非 main 不只是权限，还是**隐私边界**

### → engine/03-memory-port

- memory 是可替换 plugin（同时只开一个）
- 文件式 + 向量式并存
- MEMORY.md 仅主 session 加载

### → engine/04-long-running-tool

- OpenClaw 用 announce 模式，**根本没有** wait_external 这个概念
- 给我们启发：可能我们也不需要在 engine 加 wait_external，纯走 announce 就够了

### → engine/05-external-agent-tool-protocol

- ACP 作为统一接入协议（强烈推荐借鉴这个**意图**）
- OAuth 凭据直接读对方本地文件，自己不管 auth

### → engine/06-checkpointer-and-persistence

- session 持久化到 `~/.<app>/agents/<agentId>/sessions/`
- subagent registry 单独持久化
- cron jobs 单独持久化（`~/.<app>/cron/jobs.json`）
- **每个子系统自己持久化**，不强求统一 store

### → secretary/02-gateway-daemon

- 单一长期 daemon 拥有所有通道会话
- WS 控制面 + 首帧 connect
- 事件不重放（我们可能不学这点）
- launchd / systemd user service 安装方式

### → secretary/03-channel-adapter-framework

- 通道作为 plugin（每个 channel 一个 extension）
- 共享 `message` 工具 + 各 channel 贡献 schema 片段
- 通道队列模式（steer / followup / collect）
- 外部聊天面不发流式

### → secretary/04-dm-security-and-pairing

- 配对码 + allowlist 文件
- 凭据存 `~/.<app>/credentials/<channel>-*.json`
- inbound 在到达 agent 前 gate

### → secretary/05-scheduler-subsystem

- JSON 持久化（`~/.<app>/cron/jobs.json`，带 version 字段）
- missed-job catch-up + stagger
- cron 跑在隔离 session（不污染 IM 会话）
- cron 既是子系统也是工具

### → secretary/06-memory-backends

- 见 engine/03-memory-port 启发

### → secretary/07-skills-and-workspace

- `SKILL.md` 模板（AgentSkills 兼容）
- workspace 路径 + 全局 skills 路径合并优先级
- skills 进 prompt 不进 MCP

### → secretary/08-node-protocol

- `role: node` WS 连接
- caps 声明
- Gateway invoke 远端 cap

### → secretary/09-sandbox-and-permission

- 主 session 全权限，非主 session Docker 沙箱
- 默认工具 allow/deny 列表

### → secretary/11-external-agent-tools

- 走 ACP 一层接所有外部 agent
- OAuth 直接读对方本地文件

---

## 6. 我们不打算抄的部分

1. **多套 runtime 并存**（PI / Codex harness / ACP / CLI backend）
  → 我们就一套：Linnya graph engine。所有外部 agent 走 tool framework。
2. **事件不重放**
  → Linnya 现有的 EventStore + 重放机制更稳健，不退化。
3. **MCP 走 mcporter 外置**
  → 这是 OpenClaw 的产品取舍，我们如要 MCP 内置就内置。
4. **极重的 extensions 矩阵**（116 个扩展）
  → 前期没必要做插件平台。先把核心 8-10 个能力做扎实，将来再说插件化。
5. **subagent-spawn 的 announce 系统提示教学**（提示工程驱动）
  → 与其依赖 LLM "学会不轮询"，不如设计上让轮询不存在（系统直接 push 完成事件到下一轮）。
6. **A2UI 自己 vendor 一份 spec + renderer**
  → 如果做 Canvas，先评估直接用 vendored 包是否合适，而不是 fork。
7. **多文件命名变体**（如 `sessions-send-tool.ts` + `sessions-send-tool.a2a.ts`）
  → 这是兼容 patch 的痕迹，我们要从一开始保持单一权威文件。

---

## 7. 后续深挖待办

调研深度只到"架构层 + 关键文件路径"。如果某个 topic 工作时需要更深，回头精读：

- `src/routing/session-key.ts` 完整实现 + 测试 —— 设计 session-key 时
- `src/agents/subagent-registry.ts` + `subagent-registry-state.ts` —— 设计 async run handle 时
- `src/cron/service/timer.ts` + 测试 —— 设计 scheduler 重启 catch-up 时
- `src/agents/acp-spawn.ts` + `extensions/acpx` —— 设计 external agent tool 时
- `src/plugin-sdk/channel-contract.ts` —— 设计 channel adapter 抽象时
- `src/agents/sandbox/validate-sandbox-security.ts` —— 设计 sandbox 时
- `vendor/a2ui/specification/` —— 决定是否做 Canvas 时