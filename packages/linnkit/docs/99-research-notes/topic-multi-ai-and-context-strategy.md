# Topic · 多 AI 分工 + 精细上下文管理（CC / Codex / Hermes / OpenClaw 源码深度对比）

> 调研日期：2026-04-23
> 调研深度：**深**（4 个 explore subagent 并行直接读源码 + 关键 file:line 引用 + 8 大块调研提纲）
> 触发：linnsy `01b-product-scenarios.md` §5.6 + 衍生策略长文 [`linnsy/05-multi-ai-and-context-strategy.md`](../../../../linnsy/05-multi-ai-and-context-strategy.md)
> 笔记类型：**主题横向**（4 家全调研——4 家在多模型分工与上下文工程上的设计哲学差异最大）
> 调研纪律：严格遵循 §5.5/§5.2/§5.4 同样教训（必须直接读源码 + file:line 引用 + subagent 派发指令明令禁止只读笔记/WebSearch）

---

## 0. 本次主题为什么必须横向调研

§5.6 的题目实质是**两个独立但耦合的子题**：

- **B. 多模型分工**：一次 session 内是否使用多个不同 model（大+小）？路由准则？切换机制？
- **C. 精细上下文管理**：除 token autocompact（§5.4 已覆盖）外的 context engineering（多层记忆、tool result 留存、动态系统提示词、entity 召回）

4 家在这两块的设计哲学差异极大（CC "高频小事 Haiku" vs Hermes "auxiliary 默认跟主模型"完全相反），但**关键技术决策有共识**——这种"分歧+共识"格局对 Linnsy 取舍具有最高参考价值。

**剔除前调研已覆盖的**（本次仅在涉及时简短引用，避免重复）：
- ✅ Token autocompact / `AUTOCOMPACT_BUFFER_TOKENS=13_000` —— `topic-resource-monitoring-and-notifications.md`
- ✅ 子 agent 多轮 / `delegate_task` / `spawn_agent` —— `topic-sub-agent-multi-turn.md`
- ✅ 工作空间 / `_resolve_workspace_hint` —— 历史工作空间主题笔记已移除，相关结论以当前主文档归档为准
- ✅ inactivity timeout / 子→父心跳 —— `topic-resource-monitoring-and-notifications.md`

---

## 1. 调研提纲（8 大块）

### B 题：多模型分工
1. **B1**. 模型切换的实际场景（一次 session 内是否使用多个不同 model）
2. **B2**. 路由准则（哪些场景用大、哪些用小）
3. **B3**. 多模型在子 agent / cron / 摘要 / heartbeat 的应用
4. **B4**. 模型 fallback / escalate

### C 题：精细上下文管理
5. **C5**. 多层记忆 / 工作集架构
6. **C6**. Tool result 留存策略
7. **C7**. 系统提示词动态 vs 静态
8. **C8**. Entity / topic-based 召回

---

## 2. CC 源码事实

### 2.1 主对话与旁路小模型并存

- **统一小快模型入口**：`getSmallFastModel()` = env `ANTHROPIC_SMALL_FAST_MODEL` 或默认 Haiku：

```36:37:<upstream-workspace>/claude-code-main/src/utils/model/model.ts
export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getDefaultHaikuModel()
```

- **`queryHaiku` 强制走小快模型**（与主循环无关），`services/api/claude.ts:3241-3280`
- **主循环模型解析**：`getRuntimeMainLoopModel`（`query.ts:572-578`），plan 模式可改写

### 2.2 旁路 Haiku 场景实证表

| 场景 | 模型 | 依据 |
|------|------|------|
| Tool use 批次摘要 | `queryHaiku` | `toolUseSummaryGenerator.ts` |
| **会话重命名** | `queryHaiku` | `commands/rename/generateSessionName.ts` |
| **会话标题** | `queryHaiku` | `utils/sessionTitle.ts` |
| **离开期间 recap** | `getSmallFastModel` | `services/awaySummary.ts:47-49` |
| Web 抓取辅助 | `queryHaiku` | `tools/WebFetchTool/utils.ts` |
| **Agentic session 搜索** | `getSmallFastModel` | `utils/agenticSessionSearch.ts:261-265` |
| MCP 日期解析 | `queryHaiku` | `utils/mcp/dateTimeParser.ts` |
| Shell 前缀提取 | `queryHaiku` | `utils/shell/prefix.ts` |
| Prompt hook 默认 | `getSmallFastModel` | `utils/hooks/execPromptHook.ts` |
| Web 搜索（开关） | `getSmallFastModel`（GrowthBook `tengu_plum_vx3`） | `WebSearchTool.ts:262-281` |

**反例（绑定主模型而非 Haiku）**：
- **Permission explainer**：注释写 "using Haiku" 但实现用 `getMainLoopModel()`（`permissionExplainer.ts:143-179`）
- **Yolo 自动模式分类器**：默认 `getMainLoopModel()`，仅 env/feature flag 可改（`yoloClassifier.ts:1334-1346`）
- **`findRelevantMemories`**：用 **Sonnet**（`getDefaultSonnetModel`）的 `sideQuery`：

```97:106:<upstream-workspace>/claude-code-main/src/memdir/findRelevantMemories.ts
    const result = await sideQuery({
      model: getDefaultSonnetModel(),
      system: SELECT_MEMORIES_SYSTEM_PROMPT,
      ...
      querySource: 'memdir_relevance',
    })
```

→ **CC 的"高频小事 Haiku"是配置/经验而非原则**，记忆相关性这种"质量重于速度"的场景反而升级到 Sonnet。

### 2.3 子 agent 模型

- 默认 `getDefaultSubagentModel() = 'inherit'`（继承父）（`agent.ts:22-27`）
- env `CLAUDE_CODE_SUBAGENT_MODEL` 全局覆盖（`agent.ts:43-45`）
- built-in agents 各自配（`exploreAgent` Haiku / `claudeCodeGuideAgent` Haiku / `statuslineSetup` Sonnet / `planAgent` `inherit`）
- 非 async 子 agent 关 thinking（`runAgent.ts:678-684`）

### 2.4 Fallback：529 → 切模型

- `FallbackTriggeredError`（`withRetry.ts:160-167`）
- 触发条件：`MAX_529_RETRIES` 连续 529 + 提供 `fallbackModel`（`withRetry.ts:326-350`）
- 切换：清本回合 assistant/tool 缓冲 + 系统消息提示（`query.ts:893-947`）
- **没有"任务复杂度自动 escalate Sonnet→Opus"机制**

### 2.5 系统提示词组装与缓存（C 题）

- 主入口 `getSystemPrompt`（`constants/prompts.ts:444-576`）：静态大段 + `systemPromptSection` 动态段
- **段级 memoize**（默认缓存到 `/clear` 或 `/compact`）；`DANGEROUS_uncachedSystemPromptSection` 可破缓存（`constants/systemPromptSections.ts:16-57`）
- 动态段：`session_guidance`、`memory`、`mcp_instructions`、`env_info_simple`、`function_result_clearing`
- userContext / systemContext 分离：`getUserContext` 异步读 CLAUDE.md（`context.ts:155-188`），`getSystemContext` 含 git 快照
- API 层 `cache_control` 与 prefix split：`buildSystemPromptBlocks` + `splitSysPromptPrefix`（`claude.ts:3213-3235`）

### 2.6 Tool result 处理（4 层）

1. **超大单条落盘**：`maybePersistLargeToolResult`（`utils/toolResultStorage.ts:272-333`）→ 消息换 `<persisted-output>`
2. **同消息预算**：`applyToolResultBudget`（`query.ts:369-389`）+ `contentReplacementState` 稳定替换
3. **Microcompact**：对 `COMPACTABLE_TOOLS` 做 cache_edits 删除/引用 + 时间门触发占位（`services/compact/microCompact.ts`）
4. **Autocompact**：整段历史摘要替换（已在 §5.4 调研）

→ **不是单一"N 轮过期"模块**，是预算/微压缩/全量 compact/时间门 4 路组合。

### 2.7 Entity 召回：CC 不做 embedding

- `findRelevantMemories` 实现：扫盘获 memory 文件头清单 → LLM（Sonnet）从清单选文件名
- `memoryScan.ts:27-28` 注释明示基于文件元数据，不是向量
- CLAUDE.md 加载：路径/目录规则（`context.ts` + `utils/claudemd.ts`），不是 embedding
- `src/` 下 grep `embedding`/`vector`/`bm25`/`rerank` 用于记忆召回 **无命中**；`similarity` 仅是字符串长度比

---

## 3. Codex 源码事实

### 3.1 单线主对话 + Reasoning effort 正交（独有维度）

- 一个 `TurnContext` 对应一次推理（`session/turn_context.rs:27-40`）
- **`reasoning_effort` 与 `model` 正交**：换模型时若新模型不支持当前 effort，回退中间档（`turn_context.rs:95-122`）
- API 层：`supports_reasoning_summaries` 时发 `reasoning.effort`（`client.rs:893-905`）

### 3.2 各场景模型/effort 表

| 场景 | 默认模型 | 默认 effort | 可配置 |
|------|---------|------------|--------|
| 主对话 | 用户配置 | 用户配置 | `ConfigProfile` / `--model` / `/model` |
| Compaction | **同主 model + 同 effort** | - | 不分离 |
| **记忆 Phase1（抽取）** | `gpt-5.4-mini` | **Low** | `memories.extract_model` |
| **记忆 Phase2（巩固）** | `gpt-5.4` | **Medium** | `memories.consolidation_model` |
| Spawn 子 agent | spawn 参数指定 | spawn 参数指定 | FullHistory fork 禁止覆盖 |

```36:41:<upstream-workspace>/codex/codex-rs/core/src/memories/mod.rs
    pub(super) const MODEL: &str = "gpt-5.4-mini";
    /// Default reasoning effort used for phase 1.
    pub(super) const REASONING_EFFORT: super::ReasoningEffort = super::ReasoningEffort::Low;
```

```67:72:<upstream-workspace>/codex/codex-rs/core/src/memories/mod.rs
mod phase_two {
    /// Default model used for phase 2.
    pub(super) const MODEL: &str = "gpt-5.4";
    pub(super) const REASONING_EFFORT: super::ReasoningEffort = super::ReasoningEffort::Medium;
```

→ **Codex 是 4 家中唯一在记忆任务上明确分配"小模型低 effort 抽取 + 中模型中 effort 巩固"的**。

### 3.3 ConfigProfile + Role 层（声明式可塑性）

- `ConfigProfile`（`profile_toml.rs:20-35`）：声明式打包 model / effort / approval / sandbox 一组预设
- Role 层（`agent/role.rs:32-38`）：spawn 子 agent 时叠加 TOML 层，**默认保留调用方 profile/provider 粘性**

### 3.4 Fallback：仅故障驱动，无质量驱动

- WS→HTTP 永久切（`client.rs:1556-1571`）
- `used_fallback_model_metadata` 只是元数据告警（`turn_context.rs:594-606`），**不是 API 故障切模型链**
- **无 `try_fallback_chain` / `escalate_effort` / `try_lower_effort_first`** —— grep 全仓 0 匹配

### 3.5 ContextManager + reference_context_item 基线 diff（独有）

- `ContextManager`（`context_manager/history.rs:32-51`）：`Vec<ResponseItem>` + `reference_context_item` + token 统计
- **首轮全量 vs 稳态 diff**：`record_context_updates_and_set_reference_context_item`（`session/mod.rs:2470-2484`）
  - `reference_context_item.is_none()` → `build_initial_context`（developer + contextual user 段）
  - 否则 → `build_settings_update_items` 仅发 diff
- diff 维度：环境/权限/协作模式/人格/模型切换（`context_manager/updates.rs:14-33` + `:150-167`）

→ **稳态只发 diff** 是 4 家中唯一独有的"省 token"模式。

### 3.6 Tool result 截断 + 尾部裁剪 + Compact 过滤

- 写入历史时 `truncate_function_output_payload`（`history.rs:375-385`）
- Compact 前从尾部删 `is_codex_generated_item`（`compact_remote.rs:317-341`）
- Compact 后过滤 `should_keep_compacted_history_item`

### 3.7 AGENTS.md：路径驱动非向量

- 从项目根→cwd 收集所有 AGENTS.md 拼接（`agents_md.rs:1-16`）
- `tool_search` 用 BM25 但只搜工具清单（`tools/handlers/tool_search.rs:8-34`）
- **无 embedding / vector** 用于对话召回

---

## 4. Hermes 源码事实（4 家中 Memory 最深）

### 4.1 主对话 + Auxiliary "auto" 默认跟主模型（反直觉哲学）

- `AIAgent.model` 是单主模型一条链
- **`auxiliary_client._resolve_auto`**（`agent/auxiliary_client.py:1344-1356`）：

```7:15:<upstream-workspace>/hermes-agent/agent/auxiliary_client.py
Resolution order for text tasks (auto mode):
  1. OpenRouter  (OPENROUTER_API_KEY)
  2. Nous Portal (~/.hermes/auth.json active provider)
  3. Custom endpoint (config.yaml model.base_url + OPENAI_API_KEY)
  ...
```

```1344:1356:<upstream-workspace>/hermes-agent/agent/auxiliary_client.py
    """Full auto-detection chain.
    Priority:
      1. User's main provider + main model, regardless of provider type.
         This means auxiliary tasks (compression, vision, web extraction,
         session search, etc.) use the same model the user configured for
         chat.  Users on OpenRouter/Nous get their chosen chat model; users
         on DeepSeek/ZAI/Alibaba get theirs; etc.  Running aux tasks on the
         user's picked model keeps behavior predictable — no surprise
         switches to a cheap fallback model for side tasks.
    """
```

→ **Hermes 哲学：辅助任务默认跟主模型，"不要意外切便宜模型让用户惊讶"** —— 与 CC "高频小事 Haiku" 路线**完全相反**。

### 4.2 各任务模型来源表

| 场景 | 模型来源 | 备注 |
|------|---------|------|
| 主对话 | `AIAgent` 构造 model | - |
| Context 压缩 | `task="compression"` 走 auxiliary | 可设 `summary_model` 覆盖 |
| Web extract | `AUXILIARY_WEB_EXTRACT_MODEL` env | 可独立配 |
| Vision | `AUXILIARY_VISION_MODEL` + auto chain | 见 `vision_tools.py` |
| Session 搜索 | `task="session_search"`（注释写"cheap/fast"） | `session_search_tool.py:5-15` |
| **子 agent** | `delegation.model` / `delegation.provider` 或继承父 | `delegate_tool.py:348-404` |
| **Cron** | `job["model"]` / `HERMES_MODEL` / `config.yaml` | `cron/scheduler.py:773-887` |
| **Memory flush** | `task="flush_memories"` 走 auxiliary（cheaper） | `run_agent.py:7984-8004` |
| Embedding | 由各 memory backend SaaS 承担 | 无统一 `EMBEDDING_MODEL` env |

**未做（在 hermes-agent 全仓 grep 后）**：
- `dream` 任务管线（仅在 mock 测试中出现）
- LLM 驱动的 topic naming（`/title` 是用户字符串）
- 任务复杂度自动路由

### 4.3 子 agent / Cron 的"无包袱独立体"设计

```348:404:<upstream-workspace>/hermes-agent/tools/delegate_tool.py
    child = AIAgent(
        ...
        ephemeral_system_prompt=child_prompt,
        ...
        skip_context_files=True,
        skip_memory=True,
        ...
        iteration_budget=None,  # fresh budget per subagent
    )
```

```773:887:<upstream-workspace>/hermes-agent/cron/scheduler.py
        agent = AIAgent(
            model=model,
            ...
            disabled_toolsets=["cronjob", "messaging", "clarify"],
            quiet_mode=True,
            skip_context_files=True,  # Don't inject SOUL.md/AGENTS.md from scheduler cwd
            skip_memory=True,  # Cron system prompts would corrupt user representations
            platform="cron",
            ...
        )
```

→ Hermes **子 agent / cron = 完全独立体**：`skip_context_files` + `skip_memory` + `disabled_toolsets` + `ephemeral_system_prompt` 四件套。

### 4.4 Fallback：故障驱动 + turn 级回滚防永久钉

- `_try_activate_fallback`（`run_agent.py:6774-6785`）：API 失败重试后切链
- 切后**就地**改 `self.model` + `update_compressor_model`（`:6908-6924`）
- **`_restore_primary_runtime`**（`:6941-6967`）：每 turn 开头恢复主，避免会话永久钉 backup
- 子 agent **不继承**父 fallback 配置

### 4.5 8 Memory Backend 互斥选 1（关键真相）

- `MemoryManager`（`agent/memory_manager.py:1-10` + `:97-116`）：**builtin 必注册 + 仅允许一个外部 provider**
- 8 backend 在 `plugins/memory/`：byterover / hindsight / honcho / holographic / mem0 / openviking / retaindb / supermemory
- 各定位（注释自述）：
  - **Mem0**：云端语义+rerank+top_k
  - **Honcho**：用户建模+dialectic+多层 prefetch
  - **Holographic**：本地 SQLite+HRR+FTS5（`retrieval.py:48-64` Jaccard + HRR）
  - **OpenViking / RetainDB / Supermemory**：云端语义检索

→ **Hermes 不是"8 引擎并行"**，是"插件化互斥可选项"。Linnsy Phase 1 应**1 个云端语义 + 1 个本地工作集**而不是抄 8 个。

### 4.6 系统提示词层次 + 会话级缓存（critical）

```4001:4157:<upstream-workspace>/hermes-agent/run_agent.py
        # Layers (in order):
        #   1. Agent identity — SOUL.md when available, else DEFAULT_AGENT_IDENTITY
        #   2. User / gateway system prompt (if provided)
        #   3. Persistent memory (frozen snapshot)
        #   4. Skills guidance (if skills tools are loaded)
        #   5. Context files (AGENTS.md, .cursorrules — SOUL.md excluded here when used as identity)
        #   6. Current date & time (frozen at build time)
        #   7. Platform-specific formatting hint
```

```3993:4000:<upstream-workspace>/hermes-agent/run_agent.py
    def _build_system_prompt(self, system_message: str = None) -> str:
        """
        Called once per session (cached on self._cached_system_prompt) and only
        rebuilt after context compression events. This ensures the system prompt
        is stable across all turns in a session, maximizing prefix cache hits.
        """
```

→ **Hermes 关键设计：冻结 system + 活 user**。
- system prompt 仅压缩后重建，否则会话级缓存（最大化 prefix cache）
- memory recall 进**当前 turn user 副本**而非 system

### 4.7 Memory Recall：prefetch + 围栏注入

```9525:9634:<upstream-workspace>/hermes-agent/run_agent.py
        if self._memory_manager:
            ...
            _ext_prefetch_cache = self._memory_manager.prefetch_all(_query) or ""
        ...
                if idx == current_turn_user_idx and msg.get("role") == "user":
                    ...
                    if _ext_prefetch_cache:
                        _fenced = build_memory_context_block(_ext_prefetch_cache)
```

```65:79:<upstream-workspace>/hermes-agent/agent/memory_manager.py
build_memory_context_block  # <memory-context> 围栏防模型把召回当新用户输入
```

→ **`prefetch + <memory-context>` 围栏注入** 是 Linnsy 应学的关键模式。

### 4.8 Tool result 留存

- ContextCompressor prune（`agent/context_compressor.py:382-521`）：旧 tool 结果改单行/占位
- 工具自截断：`web_tools.MAX_OUTPUT_SIZE`、`terminal_tool` head/tail
- **Delegate 父只看 summary**（设计原则）

---

## 5. OpenClaw 源码事实

### 5.1 主对话 + 4 个独立 runKind 各自配模型

| runKind | 模型解析 | 文件 |
|---------|---------|------|
| 主对话 | `resolveDefaultModel` | `auto-reply/reply/get-reply.ts:200-218` |
| **Heartbeat** | `heartbeat.model` 独立覆盖（agent 级 + 全局回退） | `infra/heartbeat-runner.ts:1007-1020` |
| Subagent | `resolveSubagentSpawnModelSelection`（spawn override → `subagents.model` → `defaults.subagents.model` → 回落） | `agents/model-selection.ts:229-246` |
| **Cron** | **优先 `subagents.model`** 而非主模型 | `cron/isolated-agent/model-selection.ts:64-80` |
| Topic naming | `resolveDefaultModelForAgent`（同主默认） | `auto-reply/reply/conversation-label-generator.ts:25-37` |

→ **OpenClaw 是 4 家中唯一为"心跳轮"专门设计 runKind + 独立模型的**。

### 5.2 Heartbeat 三件套（独有）

```1007:1020:<upstream-workspace>/openclaw/src/infra/heartbeat-runner.ts
    const heartbeatModelOverride = normalizeOptionalString(heartbeat?.model);
    ...
    const bootstrapContextMode: "lightweight" | undefined =
      heartbeat?.lightContext === true ? "lightweight" : undefined;
    const replyOpts = {
      isHeartbeat: true,
      ...(heartbeatModelOverride ? { heartbeatModelOverride } : {}),
      suppressToolErrorWarnings,
      timeoutOverrideSeconds,
      bootstrapContextMode,
    };
```

```770:775:<upstream-workspace>/openclaw/src/infra/heartbeat-runner.ts
  // When isolatedSession is enabled, create a fresh session ...
  // This gives the heartbeat a new session ID (empty transcript) each run,
  // avoiding the cost of sending the full conversation history (~100K tokens) to the LLM.
  const useIsolatedSession = heartbeat?.isolatedSession === true;
```

→ **三件套**：① 独立 `heartbeat.model`；② `lightContext` → `bootstrapContextMode: "lightweight"`；③ `isolatedSession` 全新 session 空 transcript

### 5.3 Lightweight 模式实际砍掉什么

```165:179:<upstream-workspace>/openclaw/src/agents/bootstrap-files.ts
function applyContextModeFilter(...) {
  ...
  if (runKind === "heartbeat") {
    return params.files.filter((file) => file.name === "HEARTBEAT.md");
  }
  // cron/default lightweight mode keeps bootstrap context empty on purpose.
  return [];
}
```

→ Lightweight × runKind 矩阵：
- `heartbeat` → 只保留 `HEARTBEAT.md`
- `cron`/默认 → bootstrap 列表**故意为空**

### 5.4 Bootstrap mode + 续写跳过

```11:16:<upstream-workspace>/openclaw/src/agents/bootstrap-mode.ts
  if (!params.bootstrapPending) {
    return "none";
  }
  if (params.runKind === "heartbeat" || params.runKind === "cron") {
    return "none";
  }
```

```33:46:<upstream-workspace>/openclaw/src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts
  const isContinuationTurn =
    params.bootstrapMode !== "full" &&
    params.contextInjectionMode === "continuation-skip" &&
    params.bootstrapContextRunKind !== "heartbeat" &&
    (await params.hasCompletedBootstrapTurn(params.sessionFile));
```

### 5.5 Tool result 硬帽（4 家最严格）

```27:34:<upstream-workspace>/openclaw/src/agents/session-tool-result-guard.ts
function capToolResultSize(msg: AgentMessage, maxChars: number): AgentMessage {
  ...
  return truncateToolResultMessage(msg, maxChars, {
    suffix: (truncatedChars) => formatContextLimitTruncationNotice(truncatedChars),
    minKeepChars: 2_000,
  });
}
```

```14:27:<upstream-workspace>/openclaw/src/agents/pi-embedded-runner/tool-result-truncation.ts
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;
export const DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS = 16_000;
```

→ **OpenClaw 单条 tool result 硬帽 16K + 不超过 30% context window** —— 4 家最严格。

### 5.6 Fallback：FailoverError + prompt-side decision

```1406:1431:<upstream-workspace>/openclaw/src/agents/pi-embedded-runner/run.ts
            if (promptFailoverDecision.action === "fallback_model") {
              ...
              throw (
                normalizedPromptFailover ??
                new FailoverError(errorText, {...})
              );
            }
```

→ 配置驱动 + 错误分类触发链（与 Hermes 同模式）。

### 5.7 系统提示词：按 attempt 重建（不缓存）

- `buildEmbeddedSystemPrompt`（`pi-embedded-runner/run/attempt.ts:849-882`）每 attempt 重建
- 含 runtime info（OS/Node/model/channel/capabilities）/ heartbeat 段 / provider plugin / workspace notes / 用户时区时间
- `buildSystemPromptParams` 覆盖 channel capabilities / message tool hints

→ **OpenClaw 不像 Hermes 缓存 system，但用 runKind + lightweight 控制注入量**。

### 5.8 ContextEngine 钩子（legacy 透传）

```38:53:<upstream-workspace>/openclaw/src/context-engine/legacy.ts
  async assemble(params: {...}): Promise<AssembleResult> {
    // Pass-through: the existing sanitize -> validate -> limit -> repair pipeline
    // in attempt.ts handles context assembly for the legacy engine.
    return {
      messages: params.messages,
      estimatedTokens: 0,
    };
  }
```

→ 留了 `ContextEngine.assemble` 接口，可未来把 memory recall 从 system 迁到 assemble 阶段。

### 5.9 Memory 召回：放在独立 extension

- 配置层（`config/types.tools.ts:439-466`）：sqlite-vec + BM25 hybrid + MMR + 时间衰减
- 实现层（`extensions/memory-core/src/memory/manager-search.ts:266-275`）：FTS5 + bm25 排序 + 与 vector 路径合并
- **核心仓主路径不做向量** —— 可选 extension

---

## 6. 横向对比表（8 大块 × 4 项目）

### 6.1 多模型分工（B 题）

| # | 维度 | CC | Codex | Hermes | OpenClaw |
|---|------|----|------|--------|----------|
| B1 | 一次 session 多模型 | ✅ 主+大量 Haiku 旁路 | ⚠️ 单线 + 记忆 phase 用不同模型 | ⚠️ 主+少量 auxiliary（默认跟主） | ✅ 主+heartbeat+cron+subagent 各自配 |
| B1 | Topic naming | ✅ Haiku | - | ❌ 不做（用户字符串） | ⚠️ 同主默认模型 |
| B1 | Memory 抽取 | **Sonnet**（反直觉） | **gpt-5.4-mini Low**（独有） | task=flush_memories（auxiliary） | - |
| B1 | Heartbeat 独立模型 | - | - | - | ✅ **`heartbeat.model` 独立**（独有） |
| B2 | 自动复杂度路由 | ❌ | ❌ | ❌ | ❌ |
| B2 | 配置粒度 | global + per-agent + per-call | profile + role + spawn | global + auxiliary.<task> | global + per-agent + per-runKind |
| B3 | 子 agent 默认模型 | `'inherit'` | spawn 参数 | `delegation.model` 或继承父 | `subagents.model` 链 |
| B3 | 子 agent 上下文隔离 | partial | partial | ✅ **`skip_context_files=True` + `skip_memory=True` + `ephemeral_system_prompt`** | ✅ `lightContext` + bootstrap 空 |
| B3 | Cron 独立体 | - | - | ✅ `disabled_toolsets` + `quiet_mode` + `platform="cron"` | ✅ runKind=cron + 优先 subagent 模型 |
| B4 | API 故障 fallback | ✅ `FallbackTriggeredError`（529） | ✅ WS→HTTP 永久切 | ✅ `_try_activate_fallback` + turn 级回滚 | ✅ `FailoverError` + 配置链 |
| B4 | 复杂度自动 escalate | ❌ | ❌（reasoning effort 是显式参数） | ❌ | ❌ |
| B4 | 子 agent 继承父 fallback | ⚠️ | ⚠️ | ❌ 不继承 | ⚠️ |

### 6.2 精细上下文管理（C 题）

| # | 维度 | CC | Codex | Hermes | OpenClaw |
|---|------|----|------|--------|----------|
| C5 | 系统提示词组织 | `getSystemPrompt` + `systemPromptSection` 注册 | `BaseInstructions` + `build_initial_context` + diff | `_build_system_prompt`（7 层） | `buildEmbeddedSystemPrompt`（per-attempt） |
| C5 | 缓存策略 | **段级 memoize**（清/压时失效） | **基线 + diff**（独有） | **会话级缓存 + 仅压缩后重建** | 不缓存（attempt 级重建） |
| C5 | 用户上下文层 | `getUserContext` 异步 CLAUDE.md | `contextual_user_sections` | builtin `MemoryStore`（MEMORY.md/USER.md）+ external memory plugin | bootstrap 文件 + ContextEngine |
| C6 | Tool result 持久化处理 | 落盘 + `<persisted-output>` 引用 + microcompact + autocompact | `truncate_function_output_payload` + 尾部裁剪 | ContextCompressor prune + 工具自截断 | **16K 硬帽 + 30% context window 上限** |
| C6 | Tool result "永远留" | ❌ 4 层组合 | ❌ 截断 | ❌ prune | ❌ 硬帽 |
| C7 | 系统提示词动态部分 | env_info + memory + mcp | env/permissions/协作模式/人格/模型切换 | 时间戳/模型名/AGENTS/平台 hint | runtime info/heartbeat/provider plugin/workspace |
| C7 | Diff 增量发送 | ❌ | ✅ **`build_settings_update_items`**（独有） | ❌ | ❌ |
| C8 | Embedding 召回 | ❌ | ❌ | ✅ 8 backend 选 1（Mem0/Honcho/Holographic 等） | ⚠️ extension 可选（sqlite-vec + BM25 hybrid） |
| C8 | 路径/规则召回 | ✅ CLAUDE.md walk | ✅ AGENTS.md 根→cwd | ✅ AGENTS.md/.cursorrules | ✅ bootstrap 文件 |
| C8 | LLM-as-selector | ✅ `findRelevantMemories`（Sonnet 选文件） | - | - | - |
| C8 | 围栏注入防混淆 | partial | partial | ✅ **`<memory-context>` 围栏**（独有显式） | partial |

---

## 7. 关键产品判断

### 7.1 4 家共识（强）

1. **没人做"任务复杂度自动选大/小模型"中央路由器** —— 全部配置驱动 + 运行类型分支
2. **没人做"按复杂度自动 escalate model"** —— fallback 全是故障驱动（容量/网络/auth），Codex `reasoning_effort` 是显式参数不是动态升级
3. **所有家都做系统提示词缓存** —— 24/7 prefix cache 优化必做（策略各异）
4. **tool result 必须有界控制** —— 没有"永远完整保留"，OpenClaw 16K 硬帽 + 30% 上限是最严格基准

### 7.2 4 家分歧（哲学层面）

| 维度 | 路线 A | 路线 B |
|------|--------|--------|
| **辅助任务模型** | **CC**：高频小事 Haiku（成本敏感） | **Hermes**：auxiliary auto 默认跟主（一致性优先） |
| **系统提示词缓存** | **CC**：段级缓存（细粒度） | **Hermes/Codex**：会话级缓存或基线 diff（粗粒度） |
| **Memory 召回机制** | **CC/Codex**：路径规则 + LLM 选（无向量） | **Hermes/OpenClaw**：embedding/BM25 hybrid（向量优先） |
| **子 agent 上下文** | **CC/Codex**：默认 inherit + 部分 skip | **Hermes**：完全独立体（4 个 skip 同时开） |

→ **Linnsy 必须显式选哲学**，不是"两条路都抄"。

### 7.3 4 家盲区（Linnsy 必须自创）

1. **跨月对话历史的话题分区** —— Codex `reference_context_item` 是单线 baseline，IM 多通道多对象交织不够用
2. **联系人级（人）的长期人格** —— `ConfigProfile` 是 per-session/per-machine，不是 per-contact
3. **多模态/IM 多通道/群聊** —— 4 家都不覆盖
4. **24/7 跨月对话历史的真实负载测试** —— 4 家都没在源码里看到针对"几个月历史"的优化（Hermes 8 backend 是分担不是优化）

### 7.4 关键参考：Linnya `agent-registry` 模式（产品层 definition 注册中心）

> **来源**：`../../../../src/app-hosts/linnya/agent-registry/README.md`（同仓 host）
>
> **2026-04-23 用户拍板**：Linnsy §5.6 的 B 题"多模型分工"应直接参考 Linnya 的 `agent-registry` 模式 —— `AgentDefinition` 自带 `modelPolicy / availableTools / stepPolicy / task / integrations`，子 agent **只能触发已注册 definition**（硬约束，禁匿名）。

**Linnya `agent-registry` 关键设计抄录**（用于 Linnsy 借鉴）：

| Linnya 概念 | 文件 | Linnsy 用法 |
|---|---|---|
| `AgentDefinition` | `agent-registry/types.ts` | Linnsy 建自己的 `AgentDefinition`（含 modelPolicy / 上下文隔离开关 / 工具白名单） |
| `registry.ts`（注册 + 查找） | `agent-registry/registry.ts` | Linnsy 建 `linnsy-agent-registry`，daemon 启动时注册所有 definition |
| `modelPolicyResolver` | `agent-registry/modelPolicyResolver.ts` | 直接借鉴 —— 按 definition 解析模型 + fallback chain |
| `registeredAgentResolver`（child-run 必查 registry） | `app-hosts/linnya/adapters/child-runs/*` | 子 agent 委派必经入口 —— **禁匿名硬约束的实现位置** |
| `agents/task_*`（task 子 agent） | `agent-registry/agents/task_subagent/` 等 | Linnsy 对应 `linnsy_task_summarizer` / `linnsy_task_topic_namer` 等 |
| `chats/*`（chat task definition，每个独立 model） | `agent-registry/chats/translation/` 等 | Linnsy 对应辅助任务（topic naming / summary / translation） |
| `internals/*` | `agent-registry/internals/` | Linnsy 对应内部用 definition（如 ingestion / 知识图谱抽取） |
| `system/llm_fallback/` | `agent-registry/system/` | Linnsy 对应系统级 fallback definition |

**4 家与 Linnya 模式的对比**：

| 维度 | CC | Codex | Hermes | OpenClaw | **Linnya** |
|---|---|---|---|---|---|
| Agent 注册中心 | ❌ 隐式（按场景调函数） | ❌ 隐式 | ⚠️ subagent yaml 配置但允许临时拼装 | ⚠️ `subagents` config 数组 | ✅ **完整 registry + 硬约束禁匿名** |
| 每场景独立 modelPolicy | ⚠️ 分散在调用处 | ⚠️ 分散在调用处 | ⚠️ subagent yaml 可独立 | ✅ runKind / heartbeat 独立 | ✅ **definition 自带 modelPolicy** |
| 子 agent 硬约束（禁匿名） | ❌ | ❌ | ❌ | ❌ | ✅ **`registeredAgentResolver` 强制查 registry** |

→ **Linnya 模式比 4 家都更结构化**——Linnsy 应直接借鉴。

→ **Linnsy 借鉴的边界**：Linnya `agent-registry` 是**产品层语义注册表**，强调"声明 ≠ 执行"。Linnsy 也建自己的（不复用 Linnya 实例），不抽到 framework 层。

---

## 8. Linnsy §5.6 拍板姿势映射（详见 [`linnsy/05-multi-ai-and-context-strategy.md`](../../../../linnsy/05-multi-ai-and-context-strategy.md)）

| 拍板条目 | 来源 |
|---|---|
| **B0 总纲：注册式 agent definition + per-definition modelPolicy + 子 agent 禁匿名** | **学 Linnya `agent-registry`（同仓 host）** —— 用户 2026-04-23 拍板 |
| 多模型分工：主 + 少量小模型旁路 + heartbeat/cron 独立 definition | 学 OpenClaw runKind + CC 旁路 + Linnya registry 模式（不再做"运行时路由"） |
| 不做自动复杂度路由 | 4 家共识 + B0 总纲（registry 声明即配置） |
| 系统提示词：分层 + 会话级缓存 + 仅压缩/塑形后重建 | 学 Hermes `_cached_system_prompt` |
| Memory recall：prefetch + 围栏注入 user 侧（不进 system） | 学 Hermes `<memory-context>` |
| Memory backend：1 个本地 + 1 个云端（Phase 2） | 学 Hermes builtin + 1 个外部 plugin 模式 |
| Tool result：硬帽 + context share 上限 | 学 OpenClaw 16K + 30% |
| 子 agent 完全独立体 | 学 Hermes 4 件套（`skip_context_files` + `skip_memory` + `ephemeral_system_prompt` + `disabled_toolsets`） |
| Heartbeat 三件套 | 学 OpenClaw（独立 model + lightContext + isolatedSession） |
| Reasoning effort 独立参数（如选 OpenAI 系） | 学 Codex 正交设计 |
| 不做 reference_context diff（Phase 2 评估） | Codex 独有，复杂度高，IM 单线 baseline 适配性存疑 |

---

## 9. 残留 / 后续

- 实现阶段：回头细读 Hermes `tools/delegate_tool.py:348-404`（child AIAgent 4 件套）+ OpenClaw `bootstrap-files.ts:165-179`（lightweight × runKind 矩阵）
- Phase 2 评估：Codex `reference_context_item` 基线 + diff 是否值得引入（IM 多线 baseline 适配性需 alpha 验证）
- 长期：Linnsy 跑 alpha 一段后回头看"4 家盲区 1-4"是否真的是盲区（特别是跨月历史的负载表现），若不是反向输出社区
