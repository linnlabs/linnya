# Hermes Agent (NousResearch)

> 调研日期：2026-04-21  
> 调研深度：中（4 个 explore subagent 并行覆盖核心 runtime / 记忆 / 工具 / gateway）  
> 质量评估：⚠️ **「文档优先 + 巨型实现」的极端契约**——AGENTS.md 25KB 写得清楚、Docusaurus 文档站完整、~3000 tests + 强制 wrapper + autouse fixture **测试纪律比想象好**；但 `run_agent.py` 1.27 万行、`cli.py` 1 万行、`hermes_cli/main.py` 6K 行、`gateway/run.py` 9K 行、`mcp_tool.py` ~2K 行——**比 OpenClaw 更夸张**。  
> 借鉴边界：⚠️ **以"产品功能广度 + 架构意图"借鉴为主**，**不抄实现组织**。多个**首见**设计点值得直接学习：8 后端 memory plugin 市场 / `on_pre_compress` 钩子 / 进程内 cron 的 `advance_next_run` (at-most-once) / 17+ 渠道适配器 + 5 层鉴权 / TUI stdio JSON-RPC vs Web REST 双 UI 协议分离 / "缓存纪律"硬约束写进 AGENTS.md。

仓库位置（本机）：`<upstream-workspace>/hermes-agent/`（NousResearch/hermes-agent shallow clone）
语言：Python 主体 + TypeScript (TUI Ink + Web React)  
体量：52 MB / 顶级 30+ 文件 + 大量子目录

---

## 0. 顶层判断（必读）

Hermes 与 CC / Codex 的对比构成**第三种坐标**：

| 维度 | CC | Codex | Hermes |
|------|----|----|----|
| 工程纪律 | ⭐ 接受巨型单文件 | ⭐⭐⭐ 强制 <500 LoC/模块 | ❌ 比 CC 更夸张（1.27 万行单文件） |
| 文档质量 | ⭐ 注释解释 why | ⭐⭐ 自带 architecture docs | ⭐⭐⭐ 25KB AGENTS.md + 完整文档站 |
| 测试覆盖 | ? | ⭐⭐ 大量 _tests.rs | ⭐⭐⭐ ~3000 tests + autouse fixture 强制隔离 |
| 产品覆盖面 | ⭐⭐ 编码 + 桌面 + cron | ⭐⭐ 编码 + 多 IDE | ⭐⭐⭐⭐ **17+ IM 通道 + 8 memory 后端 + RL 训练 + ACP server + MCP 双向 + Web 仪表盘** |
| 协议清晰 | ⭐⭐ control vs content | ⭐⭐ JSON-RPC + crate | ⭐ TUI/Web/IM 各自一套 |

**Hermes 是"功能怪兽"而非"架构典范"**——但它正好是离 linnsec 产品形态最近的一个：**永远在线 + 多通道 + 多用户 + cron + skills + memory + 桌面/手机入口**。所以**借鉴"做了什么 + 为什么这样取舍"**，**不要抄"代码怎么组织"**。

**关键洞察**：Hermes 是当前唯一一个把"**多 IM 渠道适配器框架**"做完整、把"**memory provider 多后端市场**"开起来的开源项目，**这两块是我们 secretary/03 + secretary/06 的最重要参考**。

---

## 1. 项目定位

- **形态**：单 Python repo，多入口（`hermes` 主 CLI / `hermes-agent` 直接 agent 入口 / `hermes-acp` ACP server / `python -m batch_runner` / `rl_cli.py` / `mini_swe_runner.py`）
- **服务面向**：**个人/小团队长期驻场助手**——不是一次性 coding agent
- **运行模式**：CLI 聊天 / TUI / Gateway daemon（多 IM）/ ACP server（IDE 端）/ MCP server / Batch RL / 等等
- **OpenClaw 关系**：Hermes 自带 `hermes claw migrate` 命令——**自我定位为同赛道、更重一体化的竞品/替代**
- **网站**：`hermes-agent.nousresearch.com`（Docusaurus 文档站 + 产品入口）

---

## 2. 顶层目录与代码组织

### 2.1 仓库总览

| 顶级文件/目录 | 体量 | 角色 |
|--------------|------|------|
| `AGENTS.md` | 25 KB | **完整开发指南**——目录树、AIAgent 类签名、Slash 命令注册表、TUI 协议、配置 loader、皮肤、政策、Profile、已知陷阱、测试 |
| `run_agent.py` | 643 KB / **1.27 万行** | `AIAgent` 主类 + `run_conversation` 主循环 + 多 provider 适配 + IterationBudget + 子代理 |
| `cli.py` | 483 KB / ~1 万行 | `HermesCLI` 交互式控制台 + Rich + prompt_toolkit + 皮肤系统 |
| `hermes_cli/` | 52 文件 | **真正的产品入口**：`pyproject` 中 `hermes = "hermes_cli.main:main"`；约 6K 行 main.py |
| `agent/` | 34 个 .py | 从 run_agent 抽出的子模块（context_compressor / memory_provider / prompt_caching / 多 provider adapter 等） |
| `tools/` | 76 文件 | 工具实现（每文件自注册到 registry） |
| `gateway/` | 19 项 + `platforms/` | **多 IM daemon** —— GatewayRunner + 17+ 平台适配器 |
| `tui_gateway/` | 7 项 | TUI 用的 Python 后端（stdio JSON-RPC） |
| `ui-tui/` | React 19 + Ink 6 | TUI 前端（TypeScript） |
| `web/` | Vite 7 + React 19 | Web 仪表盘前端 |
| `plugins/` | memory / context_engine / disk-cleanup / example-dashboard | 插件目录（含 8 个 memory 后端） |
| `skills/` + `optional-skills/` | 71+ SKILL.md | 内置 + 可选技能 |
| `cron/` | 3 文件 | 进程内调度器 |
| `acp_adapter/` + `acp_registry/` | 9 + agent.json | ACP server 实现 + IDE 描述符 |
| `mcp_serve.py` | 30 KB | Hermes 作 MCP server（OpenClaw 9+1 工具兼容） |
| `trajectory_compressor.py` | 64 KB | 离线轨迹压缩 CLI |
| `hermes_state.py` | 59 KB | SessionDB（SQLite + WAL + FTS5） |
| `batch_runner.py` | 55 KB | 数据集批跑（多进程） |
| `mini_swe_runner.py` | 28 KB | SWE 风格 runner（Local/Docker/Modal） |
| `rl_cli.py` | 16 KB | RL 训练入口（Tinker/WandB/Atropos） |
| `tests/` | 657 .py 文件 | ~3000 测试 |
| `website/` | Docusaurus | 完整产品/开发文档 |
| `Dockerfile` + `flake.nix` + `packaging/homebrew/` + `setup-hermes.sh` | - | **Docker + Nix + Brew + 脚本**全覆盖 |
| `.env.example` | 18 KB | 反推所有外部依赖（LLM 提供商、工具 API、IM 平台等） |

### 2.2 工程纪律观察

**反面教材的极端**：
- `run_agent.py` 1.27 万行单文件（含 `AIAgent` 主类 + multiple provider adapters + 主循环 + 流式 + 重试 + 压缩）
- `cli.py` ~1 万行（含 `HermesCLI` + 皮肤 + 命令分发）
- `hermes_cli/main.py` ~6K 行（profile 预解析 + dotenv + 日志 + 所有子命令分发）
- `gateway/run.py` ~9K 行（GatewayRunner + 多适配器路由）
- `mcp_tool.py` ~2K 行（MCP 客户端，含重连/采样/sampling 安全）
- `trajectory_compressor.py` 64KB（含 tokenizer 初始化 + 同步/异步 LLM + 目录遍历 + metrics + CLI）

**正面纪律**（出乎意料）：
- AGENTS.md 写明**所有巨型文件的行数**——团队**承认**契约
- ~3000 测试 + 强制 wrapper script + autouse fixture 防环境漂移
- `tools/` 是**单文件单工具域**纪律（76 文件 = 76 个清晰边界）
- `agent/` 子模块拆得比较清晰（每个 ~hundreds of lines）

**结论**：**用文档代偿模块化**——AGENTS.md 是**新人 onboarding 的真正入口**，代码本身只能 grep。

---

## 3. AGENTS.md 解读（最值得借鉴的部分）

`AGENTS.md` 569 行，是 Hermes 团队对 **AI agents（包括人类贡献者）** 的指南。结构：

1. **Development Environment** — venv 激活
2. **Project Structure** — 目录树 + 依赖链（`tools/registry.py → model_tools.py → run_agent.py / cli.py / batch_runner.py`）
3. **AIAgent Class** — 构造函数参数 + `chat`/`run_conversation` 语义 + **伪代码主循环**
4. **CLI Architecture** — Rich/prompt_toolkit + 皮肤 + slash 命令注入策略
5. **Slash Command Registry** — `COMMAND_REGISTRY` 单一真相源跨 CLI/Gateway/Telegram/Slack/补全
6. **TUI Architecture** — 进程模型 + JSON-RPC 方法/事件表
7. **Adding New Tools** — `tools/*.py` + `toolsets.py` + 路径必须 `get_hermes_home()`
8. **Adding Configuration** — DEFAULT_CONFIG / OPTIONAL_ENV_VARS / 两套 loader
9. **Skin/Theme System** — 数据驱动皮肤
10. **Important Policies** — **Prompt Caching 禁令**
11. **Profiles** — HERMES_HOME 多实例
12. **Known Pitfalls** — 路径硬编码、ANSI、测试隔离等
13. **Testing** — 必须 `scripts/run_tests.sh`

### 关键约定（金句级）

#### 约定 1：Prompt Caching 不得被破坏

> Don't change history mid-conversation. Don't reload memory. Don't rebuild system prompt. **The only allowed mid-conversation context modification is context compression.**

**这条是 Hermes 团队对 LLM 经济学的清醒认识**——CC 在代码里实现了类似纪律但没写成宪法；Hermes 直接写进开发宪法。

**对我们的启发**：linnsec engine 应该把"缓存友好"作为**协议级约束**写进 README，避免后续每个开发者都重新踩坑。

#### 约定 2：Skill 注入是 user message，不是 system

> Skills are injected as **user messages** to preserve prompt caching.

CC + Codex 都用 `<skill>` 标签注入 user 消息，但理由没显式写出。Hermes 显式说明**为什么**——因为 system prompt 一改，整段缓存失效。

#### 约定 3：所有路径走 `get_hermes_home()`

不允许任何模块写死 `~/.hermes`——**Profile 必须 work**。

#### 约定 4：单一 COMMAND_REGISTRY

slash / 网关 / 菜单 / 补全**都从同一个 `COMMAND_REGISTRY` 读取**——避免"CLI 一套、Telegram 一套"分裂。

#### 约定 5：Profile 早于 import

`_apply_profile_override()` 必须在**任何 hermes 模块 import 之前**调用——否则 `HERMES_HOME` 被错误的默认值锁定。

**对我们的启发**：linnsec 如果支持多实例，**入口脚本必须在 import 前固定环境**。

---

## 4. 核心架构主线

### 4.1 主循环：经典同步 ReAct（既不是 generator 也不是 actor）

`AIAgent.run_conversation()` 内：

```python
# run_agent.py:9548-9573（节选）
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

**形态**：
- **同步 `while` + 阻塞 API 调用**（不是 generator/actor）
- **ReAct 风格**：模型返回 → tool_calls 执行 → tool 结果 append → 再请求模型
- **退出条件**：无 tool_calls / 用户中断 / 预算耗尽 / 接近 max_iterations
- **并行工具**：`_NEVER_PARALLEL_TOOLS` / `_PARALLEL_SAFE_TOOLS` 启发式集合

**对比 CC + Codex**：
- CC = async generator
- Codex = 双层 channel actor
- Hermes = 经典同步 while

**三种风格各有取舍**——同步 while **最容易写、最难做并发**。Hermes 选这个反映了它优先**功能广度**而非**并发优雅**。

### 4.2 IterationBudget（巧妙的预算分层）

```python
# run_agent.py:188-229
class IterationBudget:
    """Thread-safe iteration counter for an agent.
    Each agent (parent or subagent) gets its own IterationBudget.
    The parent's budget is capped at max_iterations (default 90).
    Each subagent gets an independent budget capped at delegation.max_iterations
    (default 50) — total iterations across parent + subagents can exceed parent's cap.
    """
    def refund(self) -> None:
        """Give back one iteration (e.g. for execute_code turns)."""
```

**关键设计**：
- 每个 agent（父/子）独立预算
- 子代理预算独立 = 父+子总和可超父上限（避免"一个子代理就吃光父预算"）
- `refund()` —— `execute_code` 等"非真实推理"轮次不计费

**对我们的启发**：⭐ **预算应该是树形而非全局单计数**——这是设计 multi-agent 的常见错误，Hermes 给了正确答案。

### 4.3 子代理（delegate_task）

```python
# tools/delegate_tool.py:331-405（节选）
child = AIAgent(
    ...
    max_iterations=max_iterations,
    ...
    iteration_budget=None,  # fresh budget per subagent
)
child._delegate_depth = getattr(parent_agent, '_delegate_depth', 0) + 1
# 禁止递归委派（深度硬限制）
```

**形态**：
- 工具触发子代理：`delegate_task` 工具 → 构造新 `AIAgent`
- **禁止递归委派**（`_delegate_depth` 硬限制）
- 子代理预算独立
- 工具集可定制（子代理只给一部分工具）

**对比 CC + Codex**：
- CC：`AgentTool` 同步/异步分支 + 注入 ToolUseContext
- Codex：`spawn_agent` + AgentPath 树 + mailbox
- Hermes：`delegate_task` 工具 + 深度限制 + 独立预算

**Hermes 的简化**：**没有树形命名空间，没有 mailbox，深度硬限制**——更像"打工人临时雇个外援"而非"分布式调度"。

### 4.4 SessionDB（SQLite + WAL + FTS5）

`hermes_state.py` 核心 `SessionDB`：

- **SQLite + WAL + FTS5 全文检索**（messages 表 + 触发器同步 FTS）
- 默认路径：`get_hermes_home() / "state.db"`
- 多列：`source` (cli/telegram/...), `user_id`, `parent_session_id`（压缩分裂会话）
- **应用层 jitter 重试**缓解多进程锁竞争
- **batch/RL 轨迹不存此库**（明确分离）

**对比 CC + Codex**：
- CC：`.jsonl` 全量 append-only
- Codex：JSONL + SQLite + session_index 三层
- Hermes：**SQLite + FTS5 单层**（搜索能力强，但流式重放不如 JSONL）

**对我们的启发**：⭐ **SQLite + FTS5 全文检索**对秘书场景非常合适——用户问"我们三周前讨论 X 时怎么说的"时，FTS5 直接检索全部消息。Codex 也用 SQLite 但用作"列表加速"，Hermes 用作"搜索能力"。

### 4.5 多入口 CLI 体系

| 入口 | 来源 | 角色 |
|------|------|------|
| `hermes` | `hermes_cli.main:main` | **产品级主入口**，profile 预解析 + 子命令分发 |
| `hermes-agent` | `run_agent:main` | 直接跑 agent / 列工具 / 保存轨迹（Fire 风格） |
| `hermes-acp` | `acp_adapter.entry:main` | ACP server 入口 |
| `python cli.py` | `cli.HermesCLI` | 经典聊天 console（TUI 之前的形态） |
| `python -m batch_runner` | - | 数据集批跑 |
| `python rl_cli.py` | - | RL 训练 |
| `python mini_swe_runner.py` | - | SWE benchmark runner |

**反面教材警告**：**5+ 个入口**，部分功能重叠（`cli.py` vs `hermes_cli/main.py`）——这是历史负担。新项目应**收敛到单一主入口 + 必要子命令**。

---

## 5. Memory & Context（首见的"插件市场"形态）

### 5.1 Plugin 体系架构

`plugins/` 加载来源（**四条来源，后覆盖前**）：

1. 仓库 `plugins/<name>/`（**排除 memory/ context_engine/，它们独立发现**）
2. `~/.hermes/plugins/<name>/`
3. 项目 `./.hermes/plugins/<name>/`
4. **pip 包通过 entry point 组 `hermes_agent.plugins`**

**插件协议**：`plugin.yaml` + `register(ctx)` 函数；`PluginContext` 可 `register_tool` / `register_hook` / `register_cli_command` / `register_memory_provider` 等。

**Hooks**：`pre_tool_call` / `post_tool_call` / `post_llm_call` / `on_session_end` 等。

**对我们的启发**：⭐ **四源加载 + entry point 是 Python 生态的标准做法**——但 linnsec 如果用 Node.js，可以用 npm package + ESM dynamic import 等价实现。

### 5.2 Memory plugin（首见的"8 后端市场"）

`plugins/memory/` 已实现的后端：

| 后端 | 特征 |
|------|------|
| **byterover** | 商业服务 |
| **hindsight** | ? |
| **holographic** | 本地 store + retrieval（自研，看起来是向量？） |
| **honcho** | Honcho.dev SaaS（含 session/client/cli 子模块）|
| **mem0** | mem0.ai SaaS |
| **openviking** | ? |
| **retaindb** | retaindb.com |
| **supermemory** | supermemory.ai |

**注意**：**只能选 1 个外部 provider**（`config.yaml` 的 `memory.provider` 单选）；**内置 MEMORY.md / USER.md 始终保留**。

**核心 Provider 接口** (`agent/memory_provider.py`)：

```python
class MemoryProvider(ABC):
    def initialize(self): ...
    def prefetch(self, ...): ...
    def sync_turn(self, ...): ...
    def get_tool_schemas(self): ...
    def handle_tool_call(self, ...): ...
    def on_session_end(self, messages): ...
    def on_pre_compress(self, messages): ...  # ⭐ 关键钩子
```

**`on_pre_compress` 钩子（首见的设计）**：

> 在 ContextCompressor 压缩会话之前，让 memory provider 看一眼即将丢弃的消息，把要点提取/补充到外部记忆系统，避免压缩后 recall 断档。

**对比 CC Dream + Codex 2-phase**：
- CC：每轮末尾 fire-and-forget consolidate（事后）
- Codex：启动时 2-phase pipeline（事前）
- Hermes：**压缩前 hook**（事中，**即将丢失上下文的最后一刻**）

**三种时机各有道理**。**事中钩子是最便宜也最不会漏的**——CC 的 dream 可能错过未达阈值的 session；Codex 的 startup 可能延迟若干轮才捕获；Hermes 的 pre-compress 一定能在"信息消失前"看到一次。

**对我们的启发**：⭐⭐⭐ **memory port 必须有 `on_pre_compress` 等价钩子**——否则压缩会**永久丢失**未及时持久化的关键事实。

### 5.3 Context Engine plugin

- `plugins/context_engine/__init__.py`（约 220 行）—— 扩展点已备好但**包内无第三方引擎实现**
- 默认引擎：`agent/context_compressor.py` 的 `ContextCompressor`
- 接口：`update_from_response` / `should_compress` / `compress` / `should_compress_preflight` / `on_session_start` / `on_session_end` / `get_tool_schemas` / `handle_tool_call`

**与 Memory plugin 正交**：
- Memory = **跨轮持久化 + 工具**
- Context engine = **单会话消息列表预算管理**
- 通过 `on_pre_compress` 桥接

### 5.4 Context Compressor（在线压缩）

`agent/context_compressor.py`：

- **保护头尾**（前 N 条 system / 最近 M 轮）
- **中间摘要**（按 token 预算）
- **工具结果裁剪/单行摘要**
- **迭代摘要**
- **handoff 防护**（防止把摘要当指令执行）

### 5.5 Trajectory Compressor（离线压缩，独立 CLI）

`trajectory_compressor.py` 64KB 单文件——**与 run_agent 主路径解耦**，是离线 CLI 工具，处理批处理生成的轨迹 JSON/JSONL。

**Prompt 模板（完整原文）**：

```
Summarize the following agent conversation turns concisely. This summary will replace these turns in the conversation history.

Write the summary from a neutral perspective describing what the assistant did and learned. Include:
1. What actions the assistant took (tool calls, searches, file operations)
2. Key information or results obtained
3. Any important decisions or findings
4. Relevant data, file names, values, or outputs

Keep the summary factual and informative. Target approximately {self.config.summary_target_tokens} tokens.

---
TURNS TO SUMMARIZE:
{content}
---

Write only the summary, starting with "[CONTEXT SUMMARY]:" prefix.
```

**对比 Codex 的 compact prompt** (`templates/compact/prompt.md`)：Codex 强调"handoff to another LLM that will resume the task"，Hermes 强调"replace these turns in conversation history"。**前者面向人类协作交接，后者面向上下文裁剪**——细微但重要的差异。

### 5.6 Skills 体系

- **`skills/`**：内置（安装时种子到 `~/.hermes/skills/`）
- **`optional-skills/`**：默认不启用，通过 `hermes skills` 或 hub 安装
- **`SKILL.md`**：YAML frontmatter（与 agentskills.io 兼容）+ 正文
- **触发**：
  - 模型工具：`skills_list`（元数据）+ `skill_view`（全文）—— **渐进披露**
  - CLI/Gateway：`agent/skill_commands.py` 扫描并**作为 user message 注入**（保 prompt cache）
  - Cron：`cron/scheduler.py` 的 `_build_job_prompt` 内对 `job["skills"]` 逐个 view 拼进
  - **不是关键词自动触发**——必须显式 enable 或显式 view

**71+ SKILL.md** 跨 research / devops / security / mcp / blockchain / creative / communication / migration / email / autonomous-ai-agents / productivity 等 14 大类。

**示例（`optional-skills/research/duckduckgo-search/SKILL.md`）**：

```yaml
---
name: duckduckgo-search
metadata:
  hermes:
    tags: [research, search]
    fallback_for_toolsets: [web]
---
```

### 5.7 Cron 子系统（最值得抄的部分）

`cron/` 仅 3 文件 (`__init__.py` / `jobs.py` / `scheduler.py`)，但设计很清楚：

| 维度 | Hermes 实现 |
|------|-----------|
| 调度器 | **进程内 ~60s tick**（由 Gateway 后台线程调用）|
| Cron 表达式 | `croniter` 可选依赖 |
| 并发 | `~/.hermes/cron/.tick.lock` **文件锁**（跨进程互斥）|
| 执行体 | 构造 **新 AIAgent** + `quiet_mode=True` + `skip_context_files=True` + `skip_memory=True`（**避免 cron 系统提示污染用户表征**）+ `platform="cron"` |
| 任务持久化 | `~/.hermes/cron/jobs.json`（原子写 tmp + replace）|
| 输出持久化 | `~/.hermes/cron/output/<job_id>/<timestamp>.md` |
| **重启策略** | **recurring 执行前 advance_next_run** —— 进程崩溃时**少跑优于多跑**（at-most-once 倾向）|
| **错过窗口** | `get_due_jobs` 对过期超过 grace（120s–2h 夹紧）的任务**快进到下一拍** —— **防重启风暴** |

**对我们的启发**：⭐⭐ **cron 子系统的工程意识是 Hermes 全仓最强的地方**：
- "执行前 advance" 解决重复执行问题
- "miss grace 快进" 解决重启风暴
- "skip_context_files + skip_memory" 解决系统污染
- 文件锁解决多进程

linnsec 的 scheduler 应该**直接照抄这 4 条策略**。

---

## 6. 工具 / MCP / ACP / 沙箱

### 6.1 工具体系

- **76 个工具文件**（`tools/*.py`）
- **每文件 import 时自注册**到 `tools/registry.py` 中央 `ToolRegistry`
- 发现顺序：`discover_builtin_tools()` → `discover_mcp_tools()` → `discover_plugins()`

**工具分类**：

| 类别 | 代表 |
|------|------|
| 基础设施 | registry / approval / path_security / interrupt / tool_result_storage |
| 文件 | file_tools (read/write/patch/search) / file_operations / patch_parser |
| 终端 | terminal_tool + tools/environments/{local,docker,modal,ssh,daytona,singularity} |
| Web | web_tools (Exa/Firecrawl/Parallel/Tavily 多后端) |
| 浏览器 | browser_tool + browser_cdp_tool + browser_providers/{Browserbase,Browser Use,Firecrawl}（**自研抽象，非 MCP**）|
| MCP | mcp_tool / managed_tool_gateway |
| 子代理 | delegate_tool |
| 代码执行 | code_execution_tool |
| 记忆 | memory_tool |
| 技能 | skills_* |
| Cron | cronjob_tools |
| RL | rl_training_tool |

### 6.2 Toolsets（字符串分组）

`toolsets.py`：

- **`_HERMES_CORE_TOOLS`**：全平台默认核心工具名列表
- **`TOOLSETS`**：命名分组（web / file / browser / terminal / ...）
- **`resolve_toolset` / `validate_toolset`**：支持 `includes` 引用其他 toolset

`toolset_distributions.py`：**面向 batch / RL 数据生成**——为不同 distribution 名（research / safe）配置 toolset 采样**概率**。

**对比 Codex `ToolRegistryPlan`（强类型枚举）**：Hermes 用**字符串 + 字典 + 概率**，更灵活但失去类型安全。Codex 是"配置即代码"，Hermes 是"配置即字符串数据"。

### 6.3 MCP 双向集成

**Hermes 作 MCP server** (`mcp_serve.py` 30KB)：

- **服务模式**：stdio + FastMCP
- **暴露的工具**（**对齐 OpenClaw 9 个 + 新增 channels_list**）：
  - `conversations_list` / `conversation_get`
  - `messages_read` / `messages_send`
  - `attachments_fetch`
  - `events_poll` / `events_wait`
  - `permissions_list_open` / `permissions_respond`
  - `channels_list`（Hermes 新增）

**重要**：这意味着 **CC / Cursor 等 MCP 宿主可以把 Hermes 当作"消息桥"**——查 IM 消息、回复、审批等都通过 MCP 工具完成。

**Hermes 作 MCP client** (`tools/mcp_tool.py` ~2K 行)：

- 配置：`~/.hermes/config.yaml` 的 `mcp_servers`
- 支持 stdio (command+args) + HTTP/StreamableHTTP (url)
- 可选 sampling（服务端向 Hermes 要 LLM 补全）
- 集成：动态工具名带 `mcp-` toolset 前缀

**对我们的启发**：⭐⭐ **Hermes 作 MCP server 暴露"消息桥"工具集是非常聪明的产品决策**——把 IM 消息纳入 MCP 生态，让 CC / Cursor 等可以**通过对话操作 IM**。linnsec 应该**直接学这套接口**。

### 6.4 ACP 集成（OpenClaw 之外第二个 ACP 实现）

`acp_adapter/` 9 文件（**Hermes 作 ACP server**）：

| 文件 | 角色 |
|------|------|
| `entry.py` | `asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))` —— stdio 上的 ACP |
| `server.py` | `HermesACPAgent(acp.Agent)` —— 实现 ACP 生命周期方法 |
| `session.py` | 会话状态 + 模型解析 |
| `permissions.py` / `events.py` / `tools.py` | 审批 / 事件 / 工具桥接 |
| `auth.py` | 与 hermes_cli runtime_provider 对接凭据 |

`acp_registry/agent.json`（**IDE 侧 agent 描述符**）：

```json
{
  "schema_version": "...",
  "name": "Hermes",
  "distribution": {
    "command": "hermes",
    "args": ["acp"]
  }
}
```

**关键交互模式**：**ACP 会话级 `register_mcp_servers`**——ACP 客户端可以在会话中传入 MCP server 描述，Hermes 动态扩展工具面。

**对比 OpenClaw ACP**：两者都是**作为 ACP server 暴露给 IDE**（CC、Zed 等）。两个独立实现交叉验证 ACP 正在成为"IDE ↔ Agent" 的事实标准。

**对我们的启发**：⭐ **ACP server 是 linnsec 接入 Cursor/Zed 等 IDE 的标准方式**——但优先级低于 secretary MVP。

### 6.5 Sandbox / 权限（**反例 case**）

Hermes **没有**像 Codex 那样的统一沙箱产品线。它用**组合策略**：

| 机制 | 实现 |
|------|------|
| 危险命令审批 | `tools/approval.py`：模式匹配 + DANGEROUS_PATTERNS + 会话级审批 + **辅助模型智能批准** + 永久 allowlist |
| `execute_code` | 子进程 + UDS（POSIX）/ 远程文件 RPC + **白名单工具子集**（SANDBOX_ALLOWED_TOOLS 只 7 个） |
| 敏感写 | file_tools 对 /etc / .ssh / docker.sock 等前缀有额外约束 |
| 终端多后端 | local / docker / modal / ssh / daytona / singularity = **可选隔离执行**（部署时选） |
| 部署隔离 | Docker 镜像非 root + gosu 降权 + volume |

**对比**：
- CC：5 模式 permission + bash 工具白名单
- Codex：Seatbelt + bwrap + execpolicy + Guardian 一条龙
- Hermes：**散布式审批 + 可选容器隔离**

**Hermes 在沙箱这块远不如 Codex**——是 secretary/09-sandbox-and-permission 的**反例**："不要散布式审批，应该集中"。

但 **`approval.py` 的"辅助模型智能批准"** 与 Codex Guardian 同源——是另一个独立证据点。

---

## 7. Gateway / 多通道（**linnsec 最重要的参考**）

### 7.1 Gateway 子系统总览

`gateway/` 19 项 + `platforms/` 子目录：

**核心组件**：
- `run.py` ~9K 行 —— `GatewayRunner` 消息主循环与分发
- `session.py` / `session_context.py` —— 会话与持久化
- `delivery.py` —— 出站投递
- `config.py` —— **Platform 枚举** + 配置模型
- **`pairing.py` —— DM 配对**
- `channel_directory.py` / `mirror.py` / `hooks.py` / `status.py`
- `stream_consumer.py` / `sticker_cache.py` / `restart.py`

**消息流**（来自官方 `developer-guide/gateway-internals.md`）：

```
1. Platform adapter 接收原始事件 → MessageEvent
2. Base adapter 检查 active session guard
3. GatewayRunner._handle_message():
   - 解析 session key: agent:main:{platform}:{chat_type}:{chat_id}
   - 检查授权
   - slash 命令分发
   - AIAgent.run_conversation
4. 响应通过 platform adapter 出站
```

### 7.2 17+ 渠道适配器（**直接抄清单**）

`gateway/platforms/` 已实现的 IM/网络通道：

| 国际 IM | 国内 IM | 协议/桥 | 邮件/短信 | 其它 |
|---------|---------|---------|---------|------|
| Telegram | 微信 (weixin) | Webhook 通用 | Email (IMAP/SMTP) | Home Assistant |
| Discord | 企业微信 (wecom + wecom_callback + wecom_crypto) | OpenAI 兼容 API (api_server) | SMS | Mattermost |
| Slack | 飞书 (feishu + feishu_comment + feishu_comment_rules) | iMessage (bluebubbles) | - | Matrix |
| WhatsApp | 钉钉 (dingtalk) | - | - | Signal |
| - | QQ 机器人 (qqbot/) | - | - | - |

**总计 17+ 平台** —— 这是开源界**最广的 IM 适配器集合**。

**`base.py` + `Platform` 枚举 + `ADDING_A_PLATFORM.md`** —— 扩展指南文档化。

**对我们的启发**：⭐⭐⭐ **secretary/03 channel adapter framework 应该直接以 Hermes 为蓝本**——
- 直接学 `Platform` 枚举 + `BasePlatformAdapter` 抽象类 + `ADDING_A_PLATFORM.md` 文档化
- 直接拿 17+ 平台清单作为产品路线图
- **国内 IM（微信 / 企业微信 / 飞书 / 钉钉 / QQ）已有完整实现** —— linnsec 国内运营时**省去再造**

### 7.3 Session Key（直接可抄的格式）

```
agent:main:{platform}:{chat_type}:{chat_id}
```

例：`agent:main:telegram:private:12345678`

**特点**：
- 包含 platform 维度 → 同一用户在不同平台不混
- 包含 chat_type 维度 → 群 vs 私聊隔离
- 包含 chat_id 维度 → 不同会话隔离
- **应用层只能通过 `build_session_key()` 构造**

**对我们的启发**：⭐⭐ engine/02-session-and-tenancy 直接采用此格式 + 增加可选 user_id（同群多个用户场景）。

### 7.4 5 层授权（直接可抄的策略）

授权检查顺序（**任一层 allow 即放行，否则继续**）：

```
1. per-platform allow-all
2. platform allowlist
3. DM pairing
4. global allow-all
5. default deny
```

**特点**：
- **白名单优先 + 默认拒绝**（fail-closed）
- 每个平台可独立配置
- DM pairing 是**最高粒度**——单个聊天 ID 配对

### 7.5 DM 配对机制（产品级实现）

`gateway/pairing.py`：

- **8 位配对码**（数字 + 字母）
- **过期机制**（默认 N 分钟）
- **速率限制**（防爆破）
- 文件权限 `0600`
- 存储 `~/.hermes/pairing/`
- CLI 命令：`hermes pairing approve/revoke/list`

**对我们的启发**：⭐⭐ secretary/04 DM security 直接抄。

---

## 8. UI / 协议（双 UI 协议分离）

### 8.1 TUI（stdio JSON-RPC）

- **前端**：React 19 + Ink 6 + 自建 `@hermes/ink`，TypeScript
- **后端**：`tui_gateway/` Python，stdio JSON-RPC
- **协议**：换行分隔 JSON-RPC，**stdout 专用于协议**（普通 print 重定向到 stderr）
- **方法/事件示例**：`gateway.ready` / `message.delta` / approval 等

### 8.2 Web 仪表盘（FastAPI REST + Bearer）

- **前端**：Vite 7 + React 19 + React Router 7 + Tailwind 4 + `@nous-research/ui` 设计系统
- **后端**：`hermes_cli/web_server.py` FastAPI
- **协议**：REST + 静态 SPA + 进程内 **Bearer 临时会话令牌** (`window.__HERMES_SESSION_TOKEN__`)
- **角色**：**配置/运维/会话浏览/Cron/Skills 仪表盘** —— 不是聊天界面

### 8.3 OpenAI 兼容 API server (`api_server` 平台)

- **路由**：`/v1/chat/completions` / `/v1/responses` / `/v1/runs` + SSE
- **认证**：`API_SERVER_KEY`
- **目的**：让 Open WebUI / 其它 OpenAI 兼容前端可以调用 Hermes

**对我们的启发**：⭐ **暴露 OpenAI 兼容 API 是低成本接入第三方 UI 的捷径**——linnsec 应该考虑。

### 8.4 双 UI 协议分离的意义

- **TUI = 聊天，需要低延迟双向流** → JSON-RPC over stdio（同进程父子关系）
- **Web = 运维，需要持久化连接 + 认证** → REST over HTTP + Bearer
- **不是一种协议解决两种场景** —— 这是**产品智慧**

---

## 9. 部署 / 多设备 / Profile

### 9.1 部署方式（全覆盖）

| 方式 | 文件 |
|------|------|
| Docker | `Dockerfile` + `docker/entrypoint.sh`（非 root + gosu 降权 + volume） |
| Nix | `flake.nix` + `nix/{packages,nixosModules,devShell,web,tui,python}.nix` —— 含 NixOS module |
| Homebrew | `packaging/homebrew/hermes-agent.rb` |
| 脚本 | `setup-hermes.sh`（venv/uv + 依赖 + .env + 链 ~/.local/bin） |

### 9.2 Profile（多实例隔离）

- `HERMES_HOME` 切换实例
- `_apply_profile_override()` **必须在 import 前**调用
- 每个 profile 独立：memory / sessions / skills / cron / pairing / config / state.db
- **Gateway token lock**：避免多 profile 共用同一 bot token

**对我们的启发**：⭐ linnsec 如果支持多用户/多实例，**入口脚本必须先固定 LINNSEC_HOME**。

### 9.3 .env.example 反推依赖（18KB 暴露的"配置面"）

主要分组：
1. **LLM 提供商**：OpenRouter / Gemini / Ollama Cloud / GLM / Kimi / Arcee / MiniMax / OpenCode Zen / HF / Qwen OAuth / 小米 MiMo
2. **工具 API**：Exa / Parallel / Firecrawl / FAL / Honcho
3. **Terminal**：TERMINAL_* / Docker / Podman / SSH / sudo / Modal
4. **Browser**：Browserbase 等
5. **Voice**：VOICE_TOOLS_OPENAI_KEY / Groq / STT 提供方与模型覆盖
6. **IM**：Slack / Telegram / WhatsApp / Email / Gateway 全局
7. **响应节奏 / 压缩 / RL（Tinker/W&B） / Skills Hub（GitHub） / DEBUG**

**反推**：Hermes **依赖巨广**——这是"功能怪兽"产品定位的代价。linnsec MVP 应**严格瘦身**到核心提供商。

---

## 10. 工程化质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构清晰度 | ⭐ | 文档说清楚，代码混乱 |
| 模块化纪律 | ❌ | 1.27 万行单文件，比 OpenClaw 更夸张 |
| 文档质量 | ⭐⭐⭐ | 25KB AGENTS.md + 完整 Docusaurus + 自陈巨型行数 |
| 类型系统 | ❌ | Python，无 mypy 强制 |
| 测试覆盖 | ⭐⭐⭐ | ~3000 tests + autouse fixture + 强制 wrapper |
| 协议设计 | ⭐ | TUI/Web/IM 各自一套，无统一 |
| 产品广度 | ⭐⭐⭐⭐ | **最广**：17 IM + 8 memory + RL + ACP + MCP 双向 + 多 UI |
| 性能 | ⭐ | 同步 Python while loop |
| 可维护性 | ❌ | 用文档代偿模块化，新人改 bug 必须 grep 巨型文件 |
| 可运营性 | ⭐⭐ | Docker + Nix + brew 部署完整 |

**综合**：作为**架构教材**：⚠️ 反例多于正例。作为**产品功能广度教材**：⭐⭐⭐ 当前开源最完整。

---

## 11. 对我们的启发清单（按 topic 归档）

### → engine/01-async-runs-and-handles
- ✅ 同步 ReAct + IterationBudget + delegate_task 子代理是**第三种生产实现**（CC async generator / Codex channel / Hermes while）
- ✅ **预算树形而非全局**：`refund()` + 子代理独立预算
- ⚠️ 没有"detached run"概念（cron 是独立机制不算）—— 与 CC/Codex 一致，再次验证方案 A
- ⚠️ 子代理不递归（深度硬限制）—— 偏保守

### → engine/02-session-and-tenancy
- ⭐⭐ **session_key 格式 `agent:main:{platform}:{chat_type}:{chat_id}`** 直接可抄
- ⭐ `parent_session_id` 链处理"压缩分裂会话"

### → engine/03-memory-port（重点）
- ⭐⭐⭐ **`on_pre_compress` 钩子** 是 CC + Codex 都没有的关键设计——压缩前的最后挽救
- ⭐⭐ **Memory Provider 抽象**：initialize / prefetch / sync_turn / get_tool_schemas / handle_tool_call / on_session_end / on_pre_compress
- ⭐ **内置 MEMORY/USER + 至多 1 个外部 provider** 的双轨策略
- ⭐ **8 后端市场化**：byterover / hindsight / holographic / honcho / mem0 / openviking / retaindb / supermemory —— linnsec 可以选 1-2 个先接

### → engine/04-long-running-tool
- ✅ `execute_code` 子进程 + UDS/RPC 是长任务工具的工程实现样本
- ✅ `iteration_budget.refund()` 在长任务工具上不计费——值得抄

### → engine/05-external-agent-tool-protocol
- ⭐⭐ **MCP 双向**：作 server 暴露 IM 桥工具集（OpenClaw 9+1 兼容）+ 作 client 消费外部 MCP
- ⭐ ACP 会话级动态 register_mcp_servers
- ⚠️ Toolsets 字符串分组比 Codex ToolRegistryPlan 弱，**不要照抄**

### → engine/06-checkpointer-and-persistence
- ⭐⭐ **SessionDB = SQLite + WAL + FTS5** —— FTS5 全文检索对秘书"翻旧账"场景**最合适**
- ⭐ 应用层 jitter 重试缓解锁竞争
- ⭐ batch/RL 轨迹独立存储（不污染主库）

### → engine/07-public-api-and-boundary
- ⭐ **OpenAI 兼容 API**（api_server 平台）作为低成本接入第三方 UI 的方式
- ⚠️ 协议碎片化（TUI/Web/IM 各一套）—— 反例

### → engine/08-cross-cutting
- ⭐⭐⭐ **Prompt Caching 禁令** 写进 AGENTS.md 是**金句**——我们应该把"缓存友好"作为内核宪法

### → secretary/01-product-vision-and-mvp
- ⭐ 多入口设计（hermes / hermes-agent / hermes-acp）—— 但**警告**：5+ 入口是历史负担，linnsec 收敛单一主入口

### → secretary/02-gateway-daemon
- ⭐⭐ `GatewayRunner` 单进程多适配器模型是**近似目标形态**
- ⭐ session.py + delivery.py + hooks.py 模块拆分
- ⚠️ 9K 行单文件 —— 不要抄实现组织

### → secretary/03-channel-adapter-framework（**核心参考**）
- ⭐⭐⭐ **17+ 渠道适配器清单 + Platform 枚举 + BasePlatformAdapter + ADDING_A_PLATFORM.md** 是 linnsec 最直接的参考
- ⭐⭐ **国内 IM 已完整**：微信 / 企业微信 / 飞书 / 钉钉 / QQ —— 可以学接入方式
- ⭐ webhook 通用平台 —— 让用户自己接小众 IM

### → secretary/04-dm-security-and-pairing
- ⭐⭐ **5 层授权**：per-platform allow-all → platform allowlist → DM pairing → global allow-all → default deny
- ⭐⭐ **8 位配对码 + 过期 + 速率限制 + 0600 文件权限**
- ⭐ `hermes pairing approve/revoke/list` CLI 命令

### → secretary/05-scheduler-subsystem（**核心参考**）
- ⭐⭐⭐ **进程内 ~60s tick + jobs.json + 文件锁** 是 linnsec scheduler 的最佳模板
- ⭐⭐⭐ **recurring 执行前 advance_next_run（at-most-once）** 解决重复执行
- ⭐⭐⭐ **miss grace 快进（120s-2h 夹紧）** 解决重启风暴
- ⭐⭐ **cron 任务 skip_context_files + skip_memory** 防止系统污染

### → secretary/06-memory-backends（**核心参考**）
- ⭐⭐⭐ **8 后端市场** + **统一 MemoryProvider 抽象** + **内置 MEMORY/USER 始终保留**
- ⭐⭐⭐ **on_pre_compress 钩子** 是关键
- ⭐⭐ Plugin 加载四源（仓库 / 用户 / 项目 / pip entry point）

### → secretary/07-skills-and-workspace
- ⭐⭐ **SKILL.md + agentskills.io frontmatter 兼容** + **渐进披露**（list 元数据 → view 全文）
- ⭐⭐ **作为 user message 注入**保 prompt cache（AGENTS.md 金句）
- ⭐ 内置 skills/ + optional-skills/ 双轨
- ⭐ 71+ 真实 SKILL 案例可参考

### → secretary/08-node-protocol
- ⭐⭐ **TUI stdio JSON-RPC vs Web FastAPI REST** 双 UI 协议分离 —— 不要一刀切
- ⭐ **stdout 专用于协议** + print 重定向到 stderr 的工程纪律

### → secretary/09-sandbox-and-permission
- ⭐ **辅助模型智能批准**（与 Codex Guardian 同源）—— 第二个独立证据
- ⭐ **execute_code 白名单工具子集**（SANDBOX_ALLOWED_TOOLS 仅 7 个）
- ⚠️ 散布式审批（approval / file_tools / terminal multi-backend / Docker）—— **反例**：应该集中

### → secretary/10-linnya-integration
- ⭐ **OpenAI 兼容 API server** 是 Linnya 暴露给 linnsec 的可选方式

### → secretary/11-external-agent-tools
- ⭐⭐ **MCP server 暴露消息桥工具集**（OpenClaw 9+1 兼容）—— linnsec 应该实现同套接口让 CC/Cursor/Codex 等都能"通过对话操作 IM"
- ⭐ ACP server 接入 IDE（优先级低）

### → secretary/12-voice-canvas-future
- ⭐ Voice：本地 faster-whisper / Groq / OpenAI 三档 STT 选择
- ⭐ TTS / 媒体流 / [[audio_as_voice]] 标记

### → secretary/13-deployment-and-ops
- ⭐⭐ **Docker + Nix + Homebrew + setup-hermes.sh** 全形态交付
- ⭐⭐ **Profile（HERMES_HOME 早于 import）** 多实例隔离
- ⭐ Docker 非 root + gosu 降权 + volume

---

## 12. 最值得抄的 10 个具体设计（排序按借鉴价值）

1. **`on_pre_compress` 钩子**（memory provider）—— 几行代码的事，永久避免压缩丢失
2. **session_key 格式 `agent:main:{platform}:{chat_type}:{chat_id}`** —— 一个字符串模板的事
3. **5 层授权链** —— 一个 enum + check loop
4. **8 位配对码 + 过期 + 速率限制** —— 几十行代码
5. **cron `advance_next_run` + `miss grace` + `skip_context_files`** —— 解决重启风暴 + 系统污染
6. **SQLite + WAL + FTS5** 持久化 —— 秘书翻旧账的杀器
7. **Platform 枚举 + BasePlatformAdapter + ADDING_A_PLATFORM.md** —— 渠道扩展契约
8. **MCP server 暴露 IM 桥工具集**（兼容 OpenClaw 9+1）—— 让外部 agent 可"对话操作 IM"
9. **AGENTS.md 把 Prompt Caching 写成宪法** —— 一段文档的事
10. **TUI stdio JSON-RPC vs Web REST 双协议** —— 产品智慧，不要一刀切

---

## 13. 不要抄的部分

1. **1.27 万行单文件** —— 不要用文档代偿模块化
2. **5+ 个 main 入口共存** —— 收敛单一主入口
3. **散布式审批**（approval / file_tools / terminal）—— 应该集中（学 Codex Guardian + execpolicy）
4. **toolsets 字符串分组** —— Codex ToolRegistryPlan 强类型更好
5. **environments/ 顶级 vs tools/environments/ 命名混淆** —— 命名清晰是廉价的
6. **同步 Python while loop** —— 长期不利于并发
7. **Memory provider 强制单选** —— 至少应该支持"内置 + 多个外部 provider"协作
8. **太多 LLM 提供商适配** —— linnsec MVP 严格瘦身

---

## 14. Hermes vs CC vs Codex vs OpenClaw 总对比表

| 维度 | OpenClaw | CC | Codex | Hermes |
|------|----------|----|----|--------|
| 主循环 | 自研 | async generator | Op channel + stream loop | 同步 while |
| 子代理 | sessions_spawn | AgentTool 异步/同步 | spawn_agent + agent_path | delegate_task + 深度限制 |
| 子结果 | announce 系统消息 | `<task-notification>` | `<subagent_notification>` | tool 返回 |
| 记忆 | ? | Dream (4-phase) | 2-phase (extract+consolidate) | 8 后端 plugin + on_pre_compress |
| Compact | ? | LLM-summary | 本地 + Compact API | 在线 ContextCompressor + 离线 TrajectoryCompressor |
| Skills | - | 内嵌 + SkillTool | SKILL.md + $skill 提及 | SKILL.md + 渐进披露 + user message 注入 |
| Tools 建模 | ? | 巨型 Tool 联合 | 强类型 ToolDefinition/Spec | 字符串 toolsets |
| MCP | ACP | client | client + server | **client + server (OpenClaw 9+1 兼容)** |
| ACP | **server** | - | - | **server (第二个实现)** |
| 沙箱 | Docker | 5 模式 | Seatbelt+bwrap+execpolicy+Guardian | 散布式审批 + 可选容器 |
| Cron | scheduler 注释 | in-process | ❌（cloud-tasks 替代） | **进程内 + advance_next_run + miss grace** |
| 渠道 | TG only | - | - | **17+ 平台（含国内 IM 完整）** |
| 配对 | session-key | - | workspace_id + device code | **8 位配对码 + 5 层授权** |
| 持久化 | ? | JSONL | JSONL + SQLite + index | **SQLite + WAL + FTS5** |
| Daemon | Gateway | supervisor+worker | app-server | Gateway + tui_gateway |
| UI | Web | TUI + voice | TUI + 可选 IDE | **TUI + Web 仪表盘 + IM** |
| Voice | - | WS push-to-talk | WebRTC (macOS) | local/Groq/OpenAI STT 三档 |
| 文档 | README | 注释 | 自带 architecture docs | **AGENTS.md 25KB + Docusaurus** |
| 测试纪律 | ? | ? | 邻居 _tests.rs | **~3000 + autouse fixture + 强制 wrapper** |
| 模块化 | ⚠️ 多 runtime | ⚠️ 46K 单文件 | ⭐⭐⭐ <500 LoC/模块强制 | ❌ 1.27 万行单文件 |
| **总评** | 设计意图借鉴 | 实现借鉴（部分模块） | 架构 + 实现典范 | **产品广度借鉴** |

---

## 15. 后续深挖待办

- `gateway/run.py` 中 `start_gateway` / 适配器注册顺序 —— 设计 secretary/02 时
- `platforms/api_server.py` —— 设计 OpenAI 兼容 API 时
- `tools/mcp_tool.py` 后半段（重连、采样、并发安全）—— 设计 engine/05 时
- `acp_adapter/server.py` 全量方法（initialize / prompt / session fork）—— 实现 ACP server 时
- `hermes_state.py` 后半（checkpoint / rollback / session 分裂）—— 设计 engine/06 时
- `cron/scheduler.py` 完整代码 —— 实现 secretary/05 时
- `agent/context_compressor.py` —— 设计 engine/03 在线压缩时
- `agent/memory_provider.py` —— 抄 MemoryPort 抽象时
- `gateway/pairing.py` —— 实现 DM 配对时
- `plugins/memory/holographic/` 或 `plugins/memory/honcho/session.py` —— 选样本 memory provider 看具体实现时
- `mcp_serve.py` 完整 —— 暴露 IM 桥工具时
- `website/docs/developer-guide/gateway-internals.md` —— 设计 secretary/02 + secretary/03 时（**优先于代码**）
- `website/docs/user-guide/security.md` —— 设计 secretary/04 时
