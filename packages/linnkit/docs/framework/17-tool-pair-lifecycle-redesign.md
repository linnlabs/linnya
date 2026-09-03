# 17 · 工具对生命周期重设计（input/output 分离）

> **状态**：✅ 已落地（2026-07-08，实现提交 `352995f4c`；设计提交 `abc7283ab`）。本文保留为设计依据与观察项清单。
> **触发**：一次真实事故——超长 `write_file`（≈17.7KB）恰好编译报错，下一轮上下文构建把整对压缩，真实报错被吞，模型误判"内容太长"反复重试直到用户手动停止。
> **一句话结论**：上下文层**只管 output，不管 input**；input 在"最近 2 个 turn"窗口内**原样保留、不按尺寸截断**；废除把 input+output 绑在一起算的 `MAX_TOOL_PAIR_TOKENS` 触发。

---

## 1. 问题

### 1.1 事故链路

1. AI 用 `write_file` 写了 ≈17.7KB 的 deck.js（超长 **输入参数**）。
2. 这次写入**恰好编译报错**，真实错误在 tool_output：`Property 'letterSpacing' does not exist ... (TS2339)`。
3. 下一轮上下文构建时，这个工具对的估算 token 超过 `maxPairTokens`，触发压缩：
   - **输入参数**被替换成 `工具调用参数过长，已在上下文回放中截断`；
   - **tool_output** 被摘要成 `返回了包含[error]等1个字段的对象`——真实报错正文彻底丢失。
4. 模型只剩两个信号："参数过长" + "有个 error 对象"，于是误判根因是"文件太大"，反复整体重写、换 subagent，never converge。

### 1.2 根因（三层，非"错误太多"）

- **内容层**：`letterSpacing` 用在不支持的 Text 节点（合理报错，且 api-reference 已写明）。这只是导火索。
- **上下文机制层（真凶）**：
  - 触发口径把 **input + output 绑在一起**（pair 级 token），让 1KB 的小 error 被 17KB 的大 input 拖着一起截；
  - 输入参数被替换成"参数过长"——一个会被模型读成"失败原因"的误导信号；
  - `summarizeObject` 把 `{error: "..."}` 压成"含[error]等 N 个字段的对象"，丢掉唯一有用的正文。
- **推理层**：模型 anchoring 到"参数过长"，对着错误病因开药。

---

## 2. 改造前状态：一个工具对被 4 套机制处理（2 个时机）

> 详细代码位置见文末"关键代码索引"。

### 时机一 · 执行期（工具刚跑完，逐条 output）

- **① observationGovernance**：只看 output，超 `maxChars 20000 / maxLines 1200` → 全文落盘到 `ToolOutputStore`（blob），上下文里留 preview + `blob_id`。**只碰 output，从不碰 input。** —— 这就是我们想要的 output 侧设计，已存在且方向正确。

### 时机二 · 上下文构建期（每轮发 LLM 前）

- **② 预处理器 `ToolHistoryCompressorPreprocessor`**（结构性、每轮跑、不看预算）：按 `user_input` 切"历史段 / 当前 run"；历史段 `per-run` + `keepLatestRuns=1` → 只留最近 1 个历史 run 的工具组，**更早的整组 DROP**（默认 `retentionMode='drop'`）；外加 `maxInteractionGroups=12` 硬顶。
- **③ 工作记忆 `AgentWorkingMemoryProvider`**（按 token 预算）：保留当前 turn 组 + 最近 `maxRecentToolInteractions=2` 个历史组；但每个组都过 `canFitToolPair`，只要 `pairTokens > maxPairTokens` 或超预算 → 调 `ToolPairTruncator`。**"force keep" ≠ "原样保留"**，只是"截断后还超预算也留着"。
- **④ `ToolPairTruncator` + `toolOutputSummarizer`**：input > 2000 字符 → "参数过长已截断"；output → 摘要（吞 error）。

### 改造前的三个坏味道

1. **口径混乱（4 个阈值 3 种单位并存）**：`maxPairTokens`(6000 token) + arg fold(2000 字符) + output summary(1000 token 却按 ×2 当字符用) + governance(20000 字符)。其中 pair-token 是元凶。
2. **两个默认值打架**：`config.ts` 硬编码 `MAX_TOOL_PAIR_TOKENS=10000`，`contextPolicy.ts` 默认 `maxPairTokens=6000`（走 AgentSpec 时以 6000 为准）。
3. **turn 与 tool-call 两个窗口分裂**：预处理器按 **turn/run**（`keepLatestRuns`）删除，工作记忆按 **tool-group 个数**（`maxRecentToolInteractions`）保留；且**都不阻止 truncator mangle 大 input**——即"没有任何最近 N 内 input 免截断的保护"。

### 改造前回答两个易混问题

- **超出 2 turn 是压缩还是截断？** → 预处理器层是 **DROP（整组删除）**，不是压缩也不是截断（除非显式 `retentionMode='compress'`）。
- **最近的工具对有没有被特殊保护？** → 有"保留"（不被删/挤），但**没有"免截断"**；大对照样被 truncator 改写。

---

## 3. 同类框架怎么做（调研证据）

调研了本机源码 opencode / codex / claude code，三家结论高度一致：

| 维度 | 我们（改造前） | opencode | codex | claude code |
|---|---|---|---|---|
| 截断 tool_call **输入**？ | ❌ 会（换"参数过长"） | ✅ 不截，input 原样 | ✅ 不截，`item.clone()` | ✅ 常规路径不截 |
| 处理 **output** | 摘要成零信息文案（吞 error） | 落盘+预览 / prune / LLM 摘要 | head+tail 中间截断（留头留尾） | 落盘+2KB 预览+指针 |
| 触发口径 | pair token + arg 字符（混） | token+字符+字节分层 | token 或 bytes（模型声明） | 字符为主 + token 触发压缩 |
| 最近 N 原样保留 | ❌ 无免截断保护 | ✅ 最近 2 turn + 40k token | ⚠️ compaction 保留近期 | ✅ keepRecent |

**三条行业共识**：
1. **tool_call 输入不该在上下文层截断**——三家全都不截。
2. **要截只截 output，且优先"保信息"**（head+tail 或落盘指针），没有一家把错误摘成零信息文案。
3. **最近若干轮要有原样保留窗口**（opencode 的"最近 2 turn + 40k token"最接近我们的目标）。

---

## 4. 决策（已对齐）

> 讨论日期 2026-07-08。以下为拍板结论，不是候选。

- **D1｜保护窗口按 turn 统一**：以 `user_input` 为界，**最近 2 个 turn 内的工具 input 全部原样保留**。预处理器与工作记忆统一到 turn 口径，废掉"tool-group 个数"这条并行窗口。
- **D2｜废除 pair-token 触发**：删掉把 input+output 绑一起算的 `MAX_TOOL_PAIR_TOKENS` 触发路径。窗口内 **input 不设尺寸上限**；**output 由执行期 observationGovernance 单点管**（构建期不再二次 mangle output）。
- **D3｜超窗口老 input 维持 DROP**：超出 2 turn 的老工具组，沿用现在的整组删除（`retentionMode='drop'`），不改为 compress/offload。
- **D4｜不加 error 特例**：不给 `summarizeObject` 写"error 正文豁免"。靠 D1+D2 的 **input/output 分离**根治——error 是 output 的 observation，本身很小（我们不把输入代码塞进 output），output 门槛内天然存活，无需特判。

### 4.1 目标生命周期（超长工具对，尤其超长 input）

1. **执行期**：output 超阈值 → 落盘 blob + preview（既有①，不变）；**input 永不落盘/截断**。
2. **最近 2 个 turn 内（构建期）**：input 原样保留、不按尺寸截断；output 以执行期 preview 为准、构建期不再改写；小 error 天然存活。
3. **超出 2 个 turn**：整组 DROP（含其超长 input）。

### 4.2 已知取舍与风险（决策已接受）

- **单条 input 大于整个预算**：D2 选择"不设 input 上限"，理论上一条超大 write 可能在窗口内顶爆预算。缓解：窗口只有 ~2 turn，超窗即整组 drop；但**同一 turn 内多次超大写入仍可能溢出**——列为已知风险，先不加天花板，观察后再议。
- 本次不引入 output 落盘指针的"读回"链路增强（沿用既有①），后续如需再开 topic。

---

## 5. 落地任务

> 原则：先删（去掉误导来源），再统一（turn 窗口），最后校准配置。不写兜底补丁。

- [x] **T1 · 停止截断 tool_call 输入**：`ToolPairTruncator` 已整类删除（含 `__linnya_truncated_tool_arguments` flag 与"参数过长"文案），input 原样进上下文。
- [x] **T2 · 废除 pair-token 触发**：`canFitToolPair` 只剩 `budget_exceeded` 判定，`pair_too_large` 分支与类型成员已移除。
- [x] **T3 · output 单点治理**：构建期不再二次摘要 tool_output；output 尺寸治理单点归执行期 `observationGovernance`。`toolOutputSummarizer` 仅保留给预处理器 `retentionMode='compress'` 兼容路径。
- [x] **T4 · 窗口统一到 turn**：新增 `ToolRunWindow.ts`（`resolveProtectedToolRunWindow` 按 `runOrdinal` 计算保护窗口），P1/P3 均按 turn 口径保留；`workingMemory.maxRecentToolRuns` / `MAX_RECENT_TOOL_RUNS_TO_KEEP` 作为主字段，旧 `maxRecentToolInteractions` 仅作兼容 alias。P3 只处理 compressed 摘要与保护窗口内未处理的 raw 组，不再回捞超窗口 raw input。
- [x] **T5 · 配置收敛**：`MAX_TOOL_PAIR_TOKENS` / `MAX_TOOL_OUTPUT_SUMMARY_TOKENS` / `maxPairTokens` / `maxOutputSummaryTokens` 已从 config/schema/adapter/文档全部移除，双默认值问题不复存在。
- [x] **T6 · 回归与观测**：11 个测试文件 88 个测试通过（含"超预算大 arguments 原样保留"断言）；`tsc --noEmit` 两套 tsconfig 通过、tsc baseline exact。
- [x] **T7 · 更新上下文机制文档**：`context-manager/README.md`、`docs/integration/context-engineering.md`、`tool-history.md`、CHANGELOG 已同步。

---

## 5A. 实施拆解（逐 T：改动点 / 影响面 / 测试）

> 说明：行号以本文成稿时的源码为准，实施时以实际为准；这里锁"函数/字段"级别，不锁行号。
> 建议实施顺序：**T5（配置收敛，先让口径唯一）→ T1 → T2 → T3 → T4 → T6 → T7**。原因：先把双默认值和失效字段收敛，后面删代码时不会被"另一套默认值"误导。

### T1 · 停止截断 tool_call 输入

**根因**：`ToolPairTruncator.truncateToolArguments()` 把超过 `getArgumentInlineLimitChars()`（= `MAX_TOOL_OUTPUT_SUMMARY_TOKENS × AVG_CHARS_PER_TOKEN` = 1000×2 = **2000 字符**）的 `function.arguments` 替换成"参数过长"摘要对象——这是模型误判"内容太长"的直接来源。

**改动点**
- `providers/working-memory/ToolPairTruncator.ts`
  - 删除 `truncateToolArguments()` 及其所有私有辅助：`buildTruncatedArguments` / `buildStructuredArgumentSummary` / `buildRawArgumentSummary` / `truncateArgumentValue` / `isTruncatedFieldSummary` / `isSmallSerializableValue` / `getArgumentInlineLimitChars`。
  - 删除常量：`TRUNCATED_TOOL_ARGUMENTS_FLAG` / `TRUNCATED_TOOL_ARGUMENT_FIELD_FLAG` / `TOOL_ARGUMENT_TRUNCATION_MESSAGE` / `TOOL_ARGUMENT_FIELD_TRUNCATION_MESSAGE` / `TOOL_ARGUMENT_PREVIEW_CHARS` / `TOOL_ARGUMENT_VALUE_PREVIEW_CHARS` / `TOOL_ARGUMENT_SERIALIZED_VALUE_LIMIT_CHARS` / `TOOL_ARGUMENT_IDENTITY_KEYS`。
  - `truncate()` 里移除 `const argumentResult = this.truncateToolArguments(...)`，返回值不再叠加 `argumentResult.tokensSaved`。
- 全仓 grep `__linnya_truncated_tool_arguments` / `工具调用参数过长`：确认没有别处（含 UI/审计/测试断言）依赖这个 flag 或文案；如有引用需一并清理。

**影响面**
- `keepToolGroup()` 的"截断→再判定"链路里，input 侧不再变化；这会让 `truncate()` 对"纯大 input、小 output"的组几乎无 token 可省（见 T3——output 也不再摘要后，`truncate()` 基本退化为 no-op）。这是预期的：窗口内就是要原样保留。
- assistant(tool_calls) 消息的 `overrideMetadata` 不再被写入截断版 tool_calls。

**测试**
- 端到端：一次 17KB+ 的 `write_file` 进入上下文后，`function.arguments` 原文完整（无"参数过长"字样、无 `__linnya_truncated_*` flag）。
- 反向断言：确认历史中不再出现 `TOOL_ARGUMENT_TRUNCATION_MESSAGE`。

### T2 · 废除 pair-token 触发

**改动点**
- `providers/working-memory/ToolPairMatcher.ts` · `canFitToolPair()`
  - 删除 `if (pairTokens > this.config.MAX_TOOL_PAIR_TOKENS) { ... reason: 'pair_too_large' }` 整段分支。
  - 只保留 `budget_exceeded` 判定（`currentTokens + pairTokens > budgetLimit`）。
- `providers/working-memory/types.ts`：`ToolPairFitResult.reason` 若是联合字面量类型，移除 `'pair_too_large'` 成员（避免留下无用类型分支）。

**影响面**
- 单个工具对不再因"绝对 token 上限"被判 `needsTruncation`；是否保留完全由"窗口内 force-keep / 预算"决定。这正是 D2 的目标：input 无尺寸上限，output 由执行期治理。
- 与 T5 联动：`MAX_TOOL_PAIR_TOKENS` 字段在删掉这个唯一消费点后成为死字段（T5 清理）。
- 风险（已在 4.2 记录）：同一 turn 内多次超大写入 + `budget_exceeded` 时，靠 `forceKeepWhenTruncationCannotFit` 仍会保留 → 可能顶爆预算。保持"先不加天花板、观察"。

**测试**
- 构造一个 pairTokens 远超旧 6000 但小于总预算的工具对：断言 `canFit=true`、直接保留、不进 truncator。
- `agentWorkingMemoryProvider.toolLimit.test.ts` 里依赖 `pair_too_large` 的用例需改写为"预算"语义或删除。

### T3 · output 单点治理

**改动点**
- `providers/working-memory/ToolPairTruncator.ts` · `truncateToolOutputs()` 与 `createToolOutputSummaryConfig()`
  - 移除构建期对 tool_output 的二次摘要（这是"吞 error 正文"的来源之一）；`truncate()` 不再调用它。
  - 结果：`ToolPairTruncator.truncate()` 在 T1+T3 后无实际动作 → **整类可删除**。需同步清理 `AgentWorkingMemoryProvider` / `CurrentToolInteractionRetention` / `HistoricalToolInteractionRetention` / `PostToolCallRetention` / `ToolGroupKeeper` 对 `truncator` 的构造与传参，`keepToolGroup()` 退化为"canFit? 保留 : (窗口内 force-keep? 保留超大 : 丢)"。
- `utils/toolOutputSummarizer.ts`：**保留**。它仍被预处理器 `toolHistoryCompressor.ts` 的 `compress` 模式（`compressToolInteractionGroup`）使用。仅确认默认 `retentionMode='drop'` 路径不再触达它。
- 核对"未走 governance 的裸超长 output"：检查 `toolNode.observationGovernance.ts` 是否对所有工具输出统一生效（enabled、maxChars/maxLines 触发落盘），确认没有绕过它直接进上下文的超长 output 路径。

**影响面**
- 删 `ToolPairTruncator` 是本次最大的一处结构性删除，牵动 5 个 working-memory 文件的构造/调用签名，需一次性改干净（否则 TS 编译不过）。
- output 的唯一裁剪权收敛到执行期 `observationGovernance`；构建期不再改写 output。

**测试**
- 端到端：超长 output 的工具在执行期被落盘为 preview + `blob_id`；构建期该 preview 原样进上下文，不再被二次摘要成"含[error]等 N 个字段的对象"。
- 小 error（未超 governance 阈值）：完整正文进入下一轮上下文（这是事故的核心回归点）。

### T4 · 窗口统一到 turn

**改造前状态**：预处理器已是 turn 口径（`per-run` + `keepLatestRuns=1` → 当前 turn + 最近 1 个历史 turn）；但工作记忆 P1/P3 用 **组数** `MAX_RECENT_TOOL_INTERACTIONS_TO_KEEP=2` 保留历史组，两条窗口对不齐（历史 turn 若含 >2 组，会被工作记忆按组数截掉一部分）。

**改动点**
- `providers/working-memory/CurrentToolInteractionRetention.ts` · `processToolInteractions()`
  - 现在用 `isInCurrentTurn = group.startIndex > lastUserOriginalIndex` 判当前 turn，历史组用 `maxToolPairsToKeep`（组数）计。
  - 改为 turn 口径：用 `group.runOrdinal` 判定"当前 turn + 最近 1 个历史 turn"（`runOrdinal >= maxRunOrdinal - 1`），落进窗口的组全部原样保留，不再按组数截断。
- `providers/working-memory/HistoricalToolInteractionRetention.ts` · `processHistoricalToolInteractions()`：P3 的"历史组"范围随之收敛到"仍在 2-turn 窗口但超出 P1 已保留"的组；确认 P3 不会把预处理器已判定 drop 的更旧 turn 又捞回来。
- `AgentWorkingMemoryProvider.ts`：`maxToolPairsToKeep`/`remainingToolGroups` 的计算改为 turn 驱动；`MAX_RECENT_TOOL_INTERACTIONS_TO_KEEP` / `MAX_TOOL_INTERACTION_GROUPS_TO_KEEP` 若不再作为主窗口口径，降级为"安全阀上限"或随 T5 处理。
- 复用 `toolInteractionGroup.ts` 现成的 `runOrdinal` / `findLastUserInputOriginalIndex`，不新增 turn 计算逻辑。

**影响面**
- 保护窗口由"当前 turn + N 组"变为"当前 turn + 1 个历史 turn（=2 turn）"，与预处理器完全对齐；一个历史 turn 内多组工具链不再被腰斩。
- `MIN_TOOL_INTERACTIONS_TO_KEEP=2` 的 force-keep 语义需复核：turn 口径下它是"至少保留最近 N 组"的兜底，仍可保留，但要保证不与 turn 窗口打架。

**测试**
- 构造"历史 turn 含 4 个工具组"的场景：断言这 4 组全部原样保留（旧行为只留 2 组）。
- 断言"倒数第 3 个 turn 及更早"的工具组整组不在上下文（与预处理器 drop 一致）。

### T5 · 配置收敛

**改动点**
- 双默认值：`config.ts` 的 `MAX_TOOL_PAIR_TOKENS=10000` 与 `contextPolicy.ts` `DEFAULT_CONTEXT_POLICY.toolHistory.maxPairTokens=6000`。T2 删除唯一消费点后：
  - `config.ts`：移除 `MAX_TOOL_PAIR_TOKENS` 字段（值 + interface + `validateAgentConfig` 里的相关校验：`MAX_TOOL_PAIR_TOKENS<=0`、`MAX_TOOL_OUTPUT_SUMMARY_TOKENS > MAX_TOOL_PAIR_TOKENS`）。
  - `contextPolicy.ts`：从 `AgentSpecToolHistoryPolicy` schema 与 `DEFAULT_CONTEXT_POLICY` 移除 `maxPairTokens`。
  - `agentSpecAdapter.ts`：移除 `toolHistory.maxPairTokens -> MAX_TOOL_PAIR_TOKENS` 映射（`AgentContextBuilderConfigOverrides` 同步去字段）。
- 因 D2/T3 失效的字段：`MAX_TOOL_OUTPUT_SUMMARY_TOKENS`（config + interface + adapter + `AgentSpecToolHistoryPolicy.maxOutputSummaryTokens`）——它仅服务构建期 output 摘要与 arg-fold 字符换算，两者都删。保留给 `toolHistoryCompressor` compress 模式的摘要，如需长度控制走该预处理器自己的配置，不复用这个字段。
- `avgCharsPerToken` 不得再绕过 tokenizer 做阈值判定：唯一这么用的是 `getArgumentInlineLimitChars()`/`createToolOutputSummaryConfig()`（随 T1/T3 删除）。`AVG_CHARS_PER_TOKEN` 作为 `TokenizerPort` 不可用时的兜底估算比**保留**，但确认不再有"用它算字符阈值"的用法。
- public export snapshot：`contracts/__tests__/__snapshots__/index.exports.snapshot.test.ts.snap` 及相关 schema 快照需更新。

**影响面**
- 对外契约变更：`AgentSpec.contextPolicy.toolHistory` 少两个字段（`maxPairTokens` / `maxOutputSummaryTokens`）。属破坏性变更，需在 changelog / 升级说明标注（下游若显式设过这两个字段，需移除）。
- 收敛后"一个工具对被几套阈值处理"的坏味道消除：只剩执行期 `observationGovernance`（output）+ turn 窗口（保留/丢弃）两处。

**测试**
- schema 快照与 `agentSpecAdapter.test.ts` 更新，断言移除字段后 spec 仍合法、默认值不再出现。
- `validateAgentConfig` 单测移除对已删字段的断言。

### T6 · 回归与观测

**改动点 / 断言**
- 端到端复现"超长 write + 编译报错"：断言下一轮上下文里 (a) `write_file` 的 `arguments` 原样、(b) 报错正文（TS2339 全文）完整、(c) 无任何"参数过长/含 error 字段对象"文案。
- `ContextTrace` 断言更新：工具组的 keep/drop 决策来源应指向"turn 窗口"而非"pair_too_large / arg-fold"。
- 相关既有测试文件需过一遍：`agentWorkingMemoryProvider.toolLimit.test.ts`、`multiToolFollowup.integration.test.ts`、`toolHistoryCompressor.test.ts`、`toolReplayProtocolGuard.test.ts`。

### T7 · 文档

- `context-manager/README.md`、`docs/integration/context-engineering.md`：更新"工具对处理""截断口径""thought 保留"三处描述，与本文 D1–D4 + 第 8 节缓存结论对齐；删掉 `maxPairTokens` / arg-fold / `maxOutputSummaryTokens` 的对外说明。

---

## 6. 关键代码索引

- 执行期 output 落盘：`src/runtime-kernel/graph-engine/nodes/toolNode.observationGovernance.ts`
- 预处理器（turn 级 drop/compress）：`src/context-manager/profiles/agent/preprocessors/toolHistoryCompressor.ts`
- 工作记忆保留：`src/context-manager/profiles/agent/context/providers/AgentWorkingMemoryProvider.ts` 及 `providers/working-memory/`（`ToolGroupKeeper.ts` / `ToolPairMatcher.ts` / `ToolPairTruncator.ts` / `CurrentToolInteractionRetention.ts` / `HistoricalToolInteractionRetention.ts` / `PostToolCallRetention.ts`）
- output 摘要器：`src/context-manager/profiles/agent/utils/toolOutputSummarizer.ts`
- turn/run 与工具组定义：`src/context-manager/shared/toolInteractionGroup.ts`
- 默认策略：`src/contracts/contextPolicy.ts`（`DEFAULT_CONTEXT_POLICY`）、`src/context-manager/profiles/agent/context/config.ts`
- 阈值映射：`src/context-manager/shared/agentSpecAdapter.ts`

---

## 7. 缓存命中分析（设计收益 + 待观察项）

> 本节回答："2-turn 窗口 + input 原样保留"落地后，prompt 前缀缓存会长成什么样，是收益还是代价。
> 前提：provider 的缓存是**前缀匹配**——本次请求与上次请求从头逐 token 相同的那段命中缓存，第一处不同之后全部重算。

### 7.1 turn 内稳定（收益）

同一个 turn 的工具循环里，每做一次 LLM 调用只在**尾部追加**新的 `tool_calls -> tool_output`，前面的历史（system + user + 已完成的工具组，input 原样）不再被任何构建期机制改写：

- 废除 pair-token 触发（T2）后，工具对不会因"这轮估算超阈值"被截断改写 → 同一条工具对在本 turn 内多次构建结果**逐字节一致**。
- input 原样保留（T1）后，大 `write_file` 参数不会在某一轮突然被换成"参数过长"再换回来这种抖动。

结论：**turn 内，最新一次 tool_call 之前的前缀稳定命中**，每步只为新追加的尾部付费。这是本次重设计最直接的缓存收益。

### 7.2 turn 边界重算一次（可接受代价）

用户发新请求触发新 turn 时，`ToolHistoryCompressorPreprocessor` 会把"超出 2 turn"的旧工具组整组 DROP（D3）。这次 DROP 改变了历史前缀 → 新 turn 的第一次 LLM 调用**在被删掉的那组位置断开缓存，需要重算一次**。

代价评估：每个 turn 边界只重算一次，且重算的是"更靠后的、仍保留的历史"，不是全量。属于"用一次边界重算换掉长期携带旧工具历史"的合理交换。

### 7.3 为什么 2-turn 是合理落点（权衡）

三方向拉扯：**省 token**（窗口越小越省）↔ **缓存命中**（窗口越稳越省钱）↔ **保留最近信息**（窗口越大模型上下文越全）。

- 稳定命中点落在"倒数第 3 个 turn 之前"：当前 turn + 最近 1 个历史 turn 原样保留，第 3 个 turn 起被 drop，所以跨 turn 的稳定命中边界就在倒数第 3 个 turn 处。
- 这与我们此前测算一致：2 turn 是"省 token / 命中缓存 / 保留最近信息"三者的较优折中，也和 opencode 的"最近 2 turn"窗口一致。
- 反过来看：**同一 turn 内两次 tool pair 之间不再做任何上下文处理**（本次基本删掉了这类处理）——这点与 opencode/codex/claude code 一致。任何"turn 内处理"都会丢信息且打断缓存，收益极低，所以不处理是对的。

### 7.4 replay-owned thought 去重（已解决）

生产审计确认，流式 reasoning 在同一次 Assistant 产出中形成了两份 durable 事实：

- 独立 `thought` 事件服务 UI 流式展示和审计；
- `tool_call_decision` / `final_answer` 的 `assistant_replay_parts(type='reasoning')` 保存同一可见文本、原始 part 顺序及所属 continuation，服务无状态模型回放。

三次 Slides 独立任务中，共发现 69 组相邻 `thought -> tool_call_decision`，69 组 reasoning 文本全部精确相同。旧的事件到 AiMessage 投影把两份事实都送入模型：前者成为独立 `<think>` 消息，后者成为 ordered reasoning part。随后 `MAX_THOUGHTS_TO_KEEP=1` 又在每次构建中移动这个重复 thought，形成“先重复输入、下一轮再从历史中部删除”的缓存抖动。

修复后的所有权规则是：

- durable history 继续同时保留 thought 与 ordered replay，前端和审计语义不变；
- `RuntimeEvent[] -> AiMessage[]` 永不把 thought 投影为独立模型消息；canonical reasoning 只由 ordered replay 进入模型输入；
- 不再按文本相等做去重，也不再维护 `reasoningRetention.keepLatestThoughts` / `MAX_THOUGHTS_TO_KEEP` 移动窗口；
- ordered replay 中的全部 reasoning 随所属 Assistant 消息保留到正式压缩，不读取、不合并 Provider continuation payload，也不从 `<think>` 文本伪造 sidecar。

因此，同一 turn 的常规工具循环重新满足“旧 Context 是新 Context 的严格前缀”：每一步只追加新的 `tool_calls -> tool_output`，不再移动历史中部的重复 thought。历史压缩仍应放在 turn、checkpoint、summary 或真实预算边界，而不是每个工具步骤执行。

### 7.5 预算触发是未来杠杆（观察项）

当前"是否保留一组"主要由 turn 窗口决定；`budget_exceeded`（T2 保留的唯一 `canFitToolPair` 判定）只在预算真的顶爆时才触发 drop/force-keep。也就是说**预算触发目前是兜底、不是主口径**。

未来若"同一 turn 内多次超大写入顶爆预算"（4.2 已登记风险）变成真实问题，正确的杠杆是**在窗口内引入预算触发的丢弃/降级**（例如按预算从最旧的窗口内组开始 drop），而不是回退到"按尺寸截断 input"。列为观察项：先观察是否真的发生，再决定是否引入。

---

## 8. 状态

| 项 | 状态 |
|---|---|
| 事故定位 | ✅ 完成（audit 日志全链路复盘 + 三家框架调研） |
| 设计决策 D1–D4 | ✅ 已对齐（2026-07-08） |
| T1–T7 实施拆解（改动点/影响面/测试） | ✅ 完成（见 5A） |
| 缓存命中分析（含 thoughts 影响） | ✅ 完成（见第 7 节） |
| 落地任务 T1–T7 | ✅ 已落地（2026-07-08，提交 `352995f4c`；vitest 11 文件 88 通过 + tsc baseline exact） |
| replay-owned thoughts 抖动（7.4） | ✅ 已解决：durable thought 保留，模型上下文由 ordered replay 单一承载 |
| 观察项 · 同 turn 多次超大写入顶爆预算（4.2 / 7.5） | 👀 待观察：真实发生再引入窗口内预算触发丢弃 |

**落地与设计的差异备注**（实施时的合理偏离，已确认）：

- 已新增 `workingMemory.maxRecentToolRuns` / `MAX_RECENT_TOOL_RUNS_TO_KEEP` 作为 turn 口径主字段；旧 `workingMemory.maxRecentToolInteractions` 仅作为 deprecated alias 兼容旧配置。
- `keepToolGroup` 简化为"canFit → 保留；超预算且在保护窗口 → 原样 force-keep"，保护窗口内即使超预算也不改写任何内容。
- `toolOutputSummarizer` 未删除：预处理器 `retentionMode='compress'` 兼容路径仍依赖它，默认 `drop` 主路径不触达。
