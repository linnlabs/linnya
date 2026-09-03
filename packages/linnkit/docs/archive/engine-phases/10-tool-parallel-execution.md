# 10 · Tool Parallel Execution（并行工具执行协议）

> **状态**：✅ 决策定稿，等候实施（audit §4.3 候选转正，scope 大幅缩小）  
> **日期**：2026-04-21（§6 7 题逐项定稿）  
> **触发**：扒 `toolNode.ts` 时确认"engine 当前对 LLM 一次返回的多 tool_call 始终串行执行"，对 linnya 桌面已经是真实体验痛点  
> **核心机制**：默认串行（向后兼容）+ 工具 opt-in `parallelSafe = true` → toolNode 按"前缀连续 parallelSafe"切 batch → `Promise.all` 并行执行  
> **前置**：[`00-engine-scope-audit.md` §4.3](./00-engine-scope-audit.md)

---

## 0. Q1-Q4 边界判定（先过门槛）

按 `00-engine-scope-audit.md` §1.1 流程：

| 维度 | 判断 | 证据 |
|------|------|------|
| **Q1 协议还是实现？** | ✅ 协议 | 并行调度策略 + 工具 `parallelSafe` 字段都是 engine 协议层；具体实现工作很小 |
| **Q2 ≥2 消费者真实需求？** | ✅ 强需求 | **linnya 桌面**：用户问"同时查 KB 和网页"时 LLM 回 2 个 tool_calls，当前串行 ~5s 才能继续；deep_search 子 agent 同样痛；**linnsec 秘书**：第一阶段产品必然继承 |
| **Q3 engine 不加就没法接？** | ✅ 是 | `pendingToolCalls` 数组在 LLM 解码后就在 `toolNode` 手里；产品层 wrap 不到——并行调度必须在 engine 主循环里 |
| **Q4 不破坏 Linnya？** | ✅ 是 | 设计为"默认串行（向后兼容）+ 工具显式 `parallelSafe=true` 才并行"，对所有现有工具行为 0 影响 |

**结论**：**通过 4 条门槛，确认进入 engine 升级范围**。  
**重要 scope 收缩**：本 topic **只做并行执行**，不做超时 / 优先级 / 依赖图——那些等真实需求出现再单开 topic。

---

## 1. 问题与场景

### 1.1 用户场景

#### S1：Linnya 桌面"同时查 KB 和网页"

用户问："帮我查一下知识库里有没有讲过 X，顺便搜一下网上最新的资讯"。LLM 一次返回：

```json
[
  {"function": {"name": "kb_search", "arguments": "..."}},
  {"function": {"name": "web_search", "arguments": "..."}}
]
```

**当前体验**：
1. `toolNode` 取 `calls[0]` = `kb_search`，等 ~3s
2. 路由回 `tool`，取 `calls[0]` = `web_search`（已切片），等 ~2s
3. 路由回 `llm` 继续推理

**总耗时 ~5s**。但两个工具完全无依赖——并行只需 ~3s（短板效应）。

#### S2：Deep search 子 agent 多源查询

linnya 桌面 deep_search 模式下，子 agent 一轮经常返回 3-5 个 tool_call（KB + 文件搜 + URL 抓 + ...）。串行累加是 ~10-20s 量级，并行只需最长那个 ~5s。

#### S3：linnsec 秘书一次问"日程 + 邮件 + 待办"

虽然第一阶段产品还没启动，但语义已经能预判：单次 IM 消息 LLM 回多 tool_call 是常态。

### 1.2 不解决什么

- **不解决**：超时（per-tool timeoutMs）—— 当前 abortSignal 已存在，如果将来出现"某个工具卡死要单独 kill"的真实场景，再开 `engine/0X-tool-timeout.md`
- **不解决**：优先级 / 依赖图（DAG 调度）—— 过度设计；99% 场景"全部并行 / 全部串行 / 部分并行"够用
- **不解决**：流式聚合多 tool_output 的 UI 顺序—— 这是 host SSE 层 / 前端的渲染策略，event_id 已经能稳定排序
- **不解决**：跨轮 LLM 自动回填并行结果—— LLM tool_calls 协议本来就是按数组顺序返回，本 topic 保持这个顺序的语义

---

## 2. 当前 Linnya 现状

### 2.1 串行执行的关键代码

`src/agent/runtime-kernel/graph-engine/nodes/toolNode.ts:96-99`：

```typescript
const call = calls[0];
const execution = prepareToolExecution({ prepared, call, toolCatalog: this.toolRuntime });
```

`src/agent/runtime-kernel/graph-engine/nodes/toolNode.ts:217-222`：

```typescript
return {
  kind: 'route',
  nextNodeId: remainingCalls.length > 0 ? 'tool' : 'llm',
  events: context.bridge.getRuntimeEvents(),
};
```

`src/agent/runtime-kernel/graph-engine/README.md:184` 已明确标注："取 `pendingToolCalls[0]` 执行（单工具串行）"。

### 2.2 已有协议形态（与并行相关）

| 协议 | 现状 | 对并行的影响 |
|------|------|------------|
| `abortSignal`（`state.local.signal`）| ✅ 全链路穿透 | 并行模式下，一个 call abort 后其他 call 也应当响应——`Promise.all` + 共享 signal 自然支持 |
| `tool_call_id` | ✅ 每 call 独立稳定 ID | 并行时事件归属靠 tool_call_id，零冲突 |
| `ToolNodeEventBridge` | ⚠️ 当前 toolNode 一次只创建一个 bridge | 并行时需要每个 call 一个 bridge 实例（已经能改） |
| `protocolFuse`（连续协议错误熔断）| ⚠️ 基于 `local.protocolErrorCount` 累加 | 并行时多个 call 同时失败如何累加？需要语义决定（建议：每次 batch 结束后再累加） |
| `control.requireUser` / `control.terminateRun` | ⚠️ 当前一个 call 触发就立即 route | 并行时多个 call 同时返回 control 怎么办？需要冲突解决策略 |
| `citationOffset` | ⚠️ KB 工具用，按累加分配引用编号 | **典型不能并行的工具**——并行会导致编号竞争。这也正好印证：**默认串行 + 显式 `parallelSafe`** 是对的 |
| `ToolIdempotencyPolicy` | ✅ 幂等 cache | 并行无影响 |

### 2.3 现状评估

**好消息**：
- runtime 已有 `tool_call_id` / `abortSignal` / `idempotency` 三件套，**并行的协议骨架已经有了**
- `ToolNodeEventBridge` 设计上就是 per-call 的，只是 toolNode 当前一次只用一个

**需要解决**：
- `BaseTool` / `ToolRuntimeDefinition` 没有 `parallelSafe` 字段
- `toolNode.ts` 主循环只取 `calls[0]`，需要加 batch 提取
- `protocolFuse` 的累加语义在并行下需要明确（建议：batch 内任一失败 +1，不是 N 个失败 +N）
- `control` 字段的并行冲突解决策略需要明确（建议：`terminateRun` > `requireUser` > 普通成功；同优先级按 calls 数组顺序）

---

## 3. 各参考项目做法（按本 topic 范围摘）

### 3.1 OpenClaw

参考价值：⭐

- 没有显式并行 tool 协议
- 不作正面参考

### 3.2 Codex

参考价值：⭐⭐

- Rust `core` crate 内的 tool execution 是 **structured concurrency**：tokio task spawn + 共享 cancellation token
- ToolSpec 没有 `parallelSafe` 字段，因为 Codex 的 tool 集合相对收敛（exec 系列 + apply_patch 等），并行策略硬编码
- **启发**：`parallelSafe` 字段是必要的——Linnya tool 集合多元（含 KB 编号、shared memory 等不能并行的），不能硬编码
- 详见 [`../99-research-notes/codex.md`](../99-research-notes/codex.md)

### 3.3 Claude Code

参考价值：⭐⭐⭐

- CC 自身是 Anthropic Messages API 消费者，Anthropic 协议本身支持 **`parallel_tool_calls: true/false`**
- CC 的实现：默认 `parallel_tool_calls=true`，但**单个 tool 可以 opt-out**（结构化执行有 sequential 标签）
- 部分敏感工具（如 `bash`）默认 sequential，避免文件系统竞争
- **启发**：**默认 parallel + 工具 opt-out** 是 CC 路线；我们走相反的 **默认 sequential + 工具 opt-in**（更保守，向后兼容更好）
- 详见 [`../99-research-notes/claude-code.md`](../99-research-notes/claude-code.md)

### 3.4 Hermes

参考价值：⭐⭐⭐

- Python，有 `_NEVER_PARALLEL_TOOLS` 启发式集合（含 `bash` / `compose` 等）
- 默认尝试并行，集合内的工具强制串行
- **启发**：与 CC 同路线（默认并行 + 黑名单 opt-out）
- **反例**：`_NEVER_PARALLEL_TOOLS` 是启发式硬编码，不可扩展；Linnya 的 tool 是 plugin 式的，必须用工具自己声明的 metadata（`parallelSafe` 字段）
- 详见 [`../99-research-notes/hermes.md`](../99-research-notes/hermes.md)

### 3.5 启发摘要

| 启发点 | 来源 | 是否进入 engine |
|--------|------|----------------|
| `parallelSafe` 工具元数据字段 | Codex 反面 + Hermes 反面 | ✅ engine（必须工具自声明，不能硬编码黑名单）|
| 默认 sequential + 工具 opt-in | 我们自己（vs CC/Hermes 默认 parallel）| ✅ engine（更保守、向后兼容、风险低）|
| `Promise.all` + 共享 abortSignal | Codex tokio | ✅ engine（实现细节，已有 abortSignal 复用）|
| Anthropic `parallel_tool_calls` API 字段 | CC | ⚠️ 这是 LLM 提供商层的协议，与 engine 内部并行调度是两件事——**不属于本 topic**（如要支持，归 engine/03 LlmProviderPort 扩展）|

---

## 4. 候选方案

### 方案 A（推荐）：**`parallelSafe` opt-in + batch 提取**

**做什么**：

1. `BaseTool` / `ToolRuntimeDefinition` 加可选字段：

   ```typescript
   abstract class BaseTool {
     readonly parallelSafe?: boolean;  // 默认 undefined ≡ false
     // ...其余不变
   }
   ```

2. `toolNode.ts` 改造为 batch 模式：

   ```typescript
   // 伪代码
   const batch: StandardToolCall[] = [];
   for (const call of pendingToolCalls) {
     const def = toolCatalog.getToolDefinition(call.function.name);
     if (def?.parallelSafe === true && (batch.length === 0 || batch.every(...))) {
       batch.push(call);
     } else {
       break;  // 第一个非 parallelSafe，停止累计
     }
   }
   if (batch.length === 0) batch.push(pendingToolCalls[0]);  // 至少跑一个
   const results = await Promise.all(batch.map(call => executeOne(call, sharedCtx)));
   ```

3. 每个并行 call 自己的 `ToolNodeEventBridge`（已经支持，是 per-call 创建）

4. **冲突解决策略**（明确写入文档 + 单元测试）：
   - 并行 batch 内若任一返回 `control.terminateRun=true` → batch 跑完后 yield（结束本轮 run）
   - 并行 batch 内若任一返回 `control.requireUser=true` → batch 跑完后 route 到 `wait_user`（按 calls 数组顺序取第一个 requireUser 的 spec）
   - 并行 batch 内多个失败 → `protocolErrorCount` 只 +1（不是 +N）

5. **不动 `citationOffset`**——KB 工具默认 `parallelSafe=false`，编号继续按串行累加。其他 KB 引用相关工具同理。

**优点**：
- **向后兼容 100%**：现有所有工具默认串行，行为零变化
- 工具作者主动声明，**编号竞争 / shared memory 写竞争 / 文件竞争**等问题在源头解决
- `Promise.all` + 共享 abortSignal 自然支持取消
- 改动小：`BaseTool` 加 1 字段 + `toolNode.ts` 改一段 batch 提取逻辑（≤ 200 行）

**缺点**：
- 工具作者要"想一下"才能声明 `parallelSafe`；如果忘了声明，体验劣于 CC（默认 parallel）
- 第一批受益的工具需要主动 audit：`kb_search` / `web_search` / `read_file` / `glob` / `grep` 等纯查询型应当 mark `parallelSafe=true`

### 方案 B：**A + LLM 提供商层 `parallel_tool_calls` 透传**

**做什么**（在 A 基础上）：

6. 在 `LlmProviderPort.chatCompletion` 的 params 里加 `parallelToolCalls?: boolean`，向 OpenAI / Anthropic 等支持的 provider 透传
7. 引擎默认 `true`，让 LLM 知道可以一次返回多 tool_call；`false` 时强制 sequential 逻辑（罕见场景）

**优点**：
- 配合 A 实现"end-to-end 并行"

**缺点**：
- 跨 LLM provider 该字段不统一（OpenAI 有、Anthropic 有、Gemini 部分支持、Ollama 无）
- 这是 `engine/03 LlmProviderPort` 的扩展，不属于本 topic
- → **暂不做**，等 engine/03 LlmProviderPort 落地后再开 PR 单独加

### 方案 C：**默认 parallel + 黑名单 opt-out**（CC/Hermes 路线）

**做什么**：
8. `BaseTool.parallelUnsafe?: boolean`（默认 undefined ≡ false ≡ 可并行）
9. toolNode 默认全部并行，工具显式声明 `parallelUnsafe=true` 才退化串行

**优点**：
- 默认体验更好

**缺点**：
- **向后兼容性破坏**：现有所有工具突然变并行，会引入 KB citationOffset / sharedMemory 写竞争 / 文件并发等隐藏 bug
- 需要先 audit 所有现有工具，给它们打上 `parallelUnsafe=true`，工作量大且易漏
- 风险显著高于方案 A

→ **否决方案 C**。

---

## 5. 当前倾向

### 5.1 拍板小结

**走方案 A**（默认串行 + 工具 opt-in `parallelSafe`）。  
**方案 B 暂不做**：等 engine/03 LlmProviderPort 落地后再单独加 LLM provider 层的 `parallelToolCalls` 透传（小 PR）。  
**方案 C 否决**：风险/收益不成立。

### 5.2 实施分步

| Step | 内容 | 文件 | 风险 |
|------|------|------|------|
| 1 | `BaseTool` / `ToolRuntimeDefinition` 加 `parallelSafe?: boolean` | `runtime-kernel/tools/toolContracts.ts` + `runtime-kernel/tools/ports.ts` | 低（纯类型） |
| 2 | `toolNode.ts` 改 batch 提取 + `Promise.all` 执行 | `runtime-kernel/graph-engine/nodes/toolNode.ts` | 中（核心节点，需充分回归） |
| 3 | 冲突解决策略实现（terminateRun > requireUser > 成功；protocolFuse +1 不 +N） | `toolNode.ts` + `toolNode.protocolFuse.ts` | 中 |
| 4 | 单元测试：纯并行 / 纯串行 / 混合 batch / 并行失败 / 并行 abort / 并行 requireUser | `nodes/__tests__/toolNode.parallel.test.ts`（新建） | 必做 |
| 5 | 第一批工具 audit + 标 `parallelSafe=true`：`kb_search` / `web_search` / `read_file` / `glob` / `grep` / `list_directory` 等纯查询型 | `src/app-hosts/linnya/agent-registry/*` 各 tool 实现 | 低（每个工具加 1 字段） |
| 6 | 文档更新：`runtime-kernel/tools/README.md` + `graph-engine/README.md` 节点状态机加注"并行 batch" | docs | 必做 |

**Step 1-4 是 engine 内的事；Step 5-6 是 host + docs**。整体改动 ≤ 400 行。

### 5.3 触发其他改动的可能性

| 改动 | 触发条件 |
|------|---------|
| 加 `engine/0X-tool-timeout.md` | 出现"某个工具卡死、abort 不响应"的真实场景 |
| 加 `engine/0X-tool-priority.md` | 出现"多 batch 内需要按优先级 / DAG 调度"的真实场景 |
| `LlmProviderPort.params.parallelToolCalls` | engine/03 LlmProviderPort 落地后 + 某个 provider 需要显式开关 |

→ 当前都不做。

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 用户拍板**：Q2 走 A（前缀连续）+ Q6 走 A（纯查询型一律标）+ 其他 5 题按 §5 推荐走。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | `parallelSafe` 字段名 | ✅ **`parallelSafe`** | 正向语义，与社区惯例一致（CC `parallel_tool_calls` / Anthropic API 同 `parallel_tool_calls`） |
| Q2 | batch 提取策略 | ✅ **A 前缀连续 `parallelSafe` 一组** | 保持 `calls` 顺序，复用现有"递归回 `tool` 节点"结构，实现简单且可预测；B 性能略好但要重写主循环，事后真有需要再升级不晚 |
| Q3 | 并行 batch 内多个 `requireUser` 处理 | ✅ **A 取 calls 数组中第一个 `requireUser` 的 spec** | 顺序确定性、易测；后续 LLM 重新决策时能拿到所有已完成 call 的结果，自然回到 wait_user → 再 LLM → 再决定是否继续提其他 requireUser |
| Q4 | 并行 batch 内多个 `terminateRun` 处理 | ✅ **A 任一为 true → batch 跑完 yield** | terminate 优先级最高（安全选择）；batch 内其他 call 已经在跑，让它们跑完比强行 abort 更稳 |
| Q5 | 并行 batch 内 `protocolFuse` 累加 | ✅ **A batch 内任一失败 +1**（不是 +N） | 避免一次并行 batch 直接触发熔断；语义上"这一轮工具批次有失败"才是 fuse 真正想测的信号 |
| Q6 | 第一批 audit 标 `parallelSafe=true` 的工具范围 | ✅ **A 纯查询型一律标** | 这些工具天然无副作用（无写入 / 无状态依赖 / 无编号竞争），风险接近零；上线当天用户即可感知"同时查 KB + web"的并行加速 |
| Q7 | 是否依赖 engine/07 D-1 完成 | ✅ **B 否，独立推进** | toolNode 改造（`BaseTool.parallelSafe` 字段 + batch 提取）与 D-1 exports 表无关；可与 07 / 03 三线并行 |

---

## 7. 落地任务

### 7.1 Engine 内任务

- [ ] T1：`runtime-kernel/tools/toolContracts.ts` 加 `BaseTool.parallelSafe?: boolean`
- [ ] T2：`runtime-kernel/tools/ports.ts` 加 `ToolRuntimeDefinition.parallelSafe?: boolean`
- [ ] T3：`toolNode.ts` 实现 batch 提取（按 §6 Q2 决策）
- [ ] T4：`toolNode.ts` 实现并行执行（`Promise.all` + 共享 abortSignal + per-call eventBridge）
- [ ] T5：实现冲突解决策略（terminateRun / requireUser 按 §6 Q3 Q4 决策；protocolFuse 按 §6 Q5 决策）
- [ ] T6：新建 `nodes/__tests__/toolNode.parallel.test.ts`，覆盖 6 类场景

### 7.2 Host 侧任务（Linnya）

- [ ] T7：第一批纯查询型工具加 `parallelSafe = true`，**圈定清单**（Q6=A 决议）：
  - 知识库 / 检索类：`kb_search` / `kb_chunk_lookup` / 类似只读检索
  - 文件读取类：`read_file` / `glob` / `grep` / `list_directory`
  - 网络类：`web_search` / URL 抓取（纯 GET）
  - **明确不标**：`write_file` / `edit_file` / 任何会修改 KB 引用编号 / 任何写 sharedMemory 的工具 / 任何可能产生顺序依赖的工具
- [ ] T8：手动测一遍"知识库 + 网页同时查"的真实体验，对比改造前的延迟（基线数据写进 PR description）
- [ ] T9：在 T7 圈定范围之外的所有工具，**不动**（默认 `parallelSafe` 缺省 ≡ false ≡ 串行），保证向后兼容

### 7.3 文档任务

- [ ] T10：更新 `runtime-kernel/tools/README.md` 加"`parallelSafe` 字段说明 + 何时该 mark / 何时绝对不能 mark"
- [ ] T11：更新 `runtime-kernel/graph-engine/README.md` 节点状态机加注"前缀连续 parallelSafe → batch 并行；遇到第一个非 parallelSafe → 退化串行回 'tool'"
- [ ] T12：更新 `00-engine-scope-audit.md` §4.3 把状态同步为"✅ 已定稿，等候实施"（已在前一轮完成此项）

---

## 8. 状态

- [x] §0 边界判定通过 Q1-Q4
- [x] §1 用户场景明确（S1-S3）
- [x] §2 当前 Linnya 现状盘点完成（含 7 个相关协议影响分析）
- [x] §3 参考项目启发汇总
- [x] §4 候选方案 + 取舍（方案 A 主路径 + B 暂搁 + C 否决）
- [x] §5 当前倾向（方案 A 分步 + 触发其他改动条件）
- [x] §6 7 个待决策问题已逐项定稿（2026-04-21）
- [x] §7 落地任务展开为 T1-T12
- [ ] 进入实施

**下一步**：
1. ✅ §6 决策已定（默认串行 + `parallelSafe` opt-in / 前缀连续 batch / 第一批纯查询型一律标）
2. T1-T6 engine 内实施（可与 engine/03 / engine/07 并行推进，本 topic 与 D-1 exports 表无依赖）
3. T7-T9 host 侧 audit + 实测
4. T10-T12 文档同步
