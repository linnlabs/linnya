# 02 · Session and Tenancy（conversationId 协议）

> **状态**：✅ 决策定稿，等候实施（scope 极小）  
> **日期**：2026-04-21  
> **触发**：audit §4 修订 02 范围 = "engine 只问 `conversationId` 协议是否需要演进；session_key / 多通道路由完全归 secretary"  
> **前置**：
> - [`00-engine-scope-audit.md` §1.4](./00-engine-scope-audit.md) "engine 留接口、不做工具、信息丰富" 原则
> - [`01-async-runs-and-handles.md` §6 Q6](./01-async-runs-and-handles.md) detached run 与父 run 的 LLM 上下文关系（部分推到本 topic）

---

## 0. Q1-Q4 边界判定（先过门槛）

| 维度 | 判断 | 证据 |
|------|------|------|
| **Q1 协议还是实现？** | ✅ 协议 | `conversationId` 是 engine 与产品层的契约符号；session_key 模板（`agent:main:{platform}:{chat_type}:{chat_id}`）是产品语义实现 |
| **Q2 ≥2 消费者真实需求？** | ✅（针对 conversationId 协议本身） | 三个产品（linnya / linnsec / 未来）都用 conversationId；但**当前 conversationId opaque string 协议已经够薄、够通用** |
| **Q3 engine 不加就没法接？** | ⚠️ **协议核心：否（已有就够）；周边元数据：是（需要让上层挂载产品语义）** | 详见 §5 |
| **Q4 不破坏 Linnya？** | ✅ | 设计为"周边字段扩展、conversationId 本身语义不变" |

**结论**：通过 4 条门槛，但 **scope 极小**——engine 只补"周边可挂载产品元数据"的接口空间，**conversationId 本身保持 opaque 不变**。session_key 模板、IM 平台标识、群/私聊概念全部归 secretary。

---

## 1. 问题与场景

### 1.1 用户场景

#### S1：linnya 桌面"同一对话多 run"

用户在同一 conversation 里发起多次 agent 调用 → 每次 = 一个 run，但同一 conversationId。

**当前**：engine 已支持（conversationId + Checkpointer 复用 EngineState）。

#### S2：linnsec "老板的'调研报告'子任务"

老板让 linnsec 跑一个调研，linnsec 内部 spawn 一个 detached run。这个 detached run 与"老板与 linnsec 的主对话"是什么关系？
- **方案 X**：复用主对话的 conversationId → engine state 会被两个 run 共写，冲突
- **方案 Y**：新开 conversationId，但记录 `parentConversationId` 关系
- **方案 Z**：完全不挂亲子，由产品层 `RunRecord.parentRunId` 表达

**当前**：engine 没有显式 `parentConversationId` 字段；产品层只能在 `metadata` 里暗号约定。

#### S3：linnsec 多 IM 通道汇聚

老板在微信、Telegram、邮件三处问"调研做完没"——secretary 需要把三处会话汇聚到同一个"老板秘书会话"。

→ 这是 **secretary** 的事（多通道 → 单 session_key 映射）。**engine 不该理解 platform / chat_type 概念**。

### 1.2 用户场景启示

- conversationId 协议需要的是 "**opaque string + 可选挂载点**"，不是定义新格式
- 父子 run 关系应当让 engine 提供 capability（在 RunHandle / 调用 request 上留 `parentConversationId?`）
- 通道汇聚 / session_key 模板 全部归 secretary，engine 一眼都不看

### 1.3 不解决什么

- **不解决**：session_key 模板（`platform / chat_type / chat_id`）—— 归 secretary
- **不解决**：跨产品 conversationId 命名空间—— 每个产品自己管
- **不解决**：多租户隔离—— 进程 / DB schema 级别隔离归产品层
- **不解决**：context-manager 内部的 history / summary 数据结构—— 是 context-manager 自己的事

---

## 2. 当前 Linnya 现状

### 2.1 conversationId 在 engine 里的定位

`grep` 验证：`conversationId` 出现在 EngineState / toolNode / llmNode / event-bridge / Checkpointer / RunSupervisor / events / context-pipeline 共 ~25+ 个文件。**它是 engine 内部最广泛使用的会话标识符**。

特征：
- ✅ Opaque string，engine 不解析
- ✅ Checkpointer 按它索引
- ✅ ToolExecutionContext / EventBridge 都靠它定位
- ⚠️ 没有显式的 `parentConversationId` 字段
- ⚠️ 没有显式的 `metadata` 挂载点（产品语义只能塞进 AgentInvocationRequest 顶层）

### 2.2 AgentInvocationRequest 现状

`src/agent/ports/agent-invocation.ts`：

```typescript
export interface AgentInvocationRequest {
  query: string;
  promptKey: PromptKey;
  model_id?: string;
  imageGenerationModelId?: string;
  mode?: 'agent' | 'chat';
  maxSteps?: number;
  enableTools?: boolean;
  availableTools?: string[];
  conversationHistory?: AiMessage[];
}
```

**评估**：
- ❌ 没有 `conversationId` 显式字段（隐式靠 `runUntilYield(state, ...)` 的 EngineState 携带）
- ❌ 没有 `parentConversationId` / `parentRunId` 字段
- ❌ 没有 `metadata: Record<string, unknown>` 挂载点

按 §1.4 "信息丰富" 原则：**这些字段应当主动留**，否则上层做工具时只能塞进 query 字符串里 hack。

### 2.3 EngineState.conversationId 现状

`src/agent/runtime-kernel/graph-engine/types.ts:17`：

```typescript
conversationId?: string;  // optional, opaque
```

**评估**：可选字段、opaque、没有相关元数据—— **协议本身已经足够薄**，无需修改 EngineState 内部 schema，只需在调用入口（`AgentInvocationRequest`）和 RunSupervisor API 上加挂载点。

---

## 3. 各参考项目做法（按本 topic 范围摘）

### 3.1 OpenClaw

参考价值：⭐

- 没有清晰的 conversation 概念抽象
- 不作正面参考

### 3.2 Codex

参考价值：⭐⭐⭐

- `Conversation` + `Thread` + `Turn` 三层抽象（强结构）
- `AgentPath` 用路径表达 agent 父子关系（"主 agent / 子 agent A / 孙 agent B"）
- **启发**：Codex 把"agent 树形关系"显式化是**capability 层的设计**，但路径编码（`/main/research/citation`）是产品层 naming
- 我们的对应：`parentRunId` 隐式构成树（engine 留接口）；产品层自己决定是否做显式 path naming
- 详见 [`../99-research-notes/codex.md`](../99-research-notes/codex.md)

### 3.3 Claude Code

参考价值：⭐⭐

- `taskId` + `Task.{name, type, kill()}`—— 浅层会话抽象
- 没有显式的 parentConversation 概念，团队 agent 走"邮箱"扁平命名
- **启发**：单进程产品下，conversation 不需要太重的元数据—— 与我们 "engine 留挂载点不强制" 一致

### 3.4 Hermes

参考价值：⭐⭐⭐

- `session_key = agent:main:{platform}:{chat_type}:{chat_id}`—— 产品语义全在模板里
- SessionDB 用 session_key 主键
- **启发**：**这是产品层 naming**，engine 不该理解 `platform` / `chat_type`；secretary 在 `secretary/02-gateway-daemon.md` 复用此模式
- 详见 [`../99-research-notes/hermes.md`](../99-research-notes/hermes.md)

### 3.5 启发摘要

| 启发点 | 来源 | 是否进入 engine |
|--------|------|----------------|
| `parentRunId` 隐式树 | Codex AgentPath 简化版 | ✅ engine（已在 [`engine/01 §5.2`](./01-async-runs-and-handles.md) 留接口） |
| `metadata: Record<string, unknown>` 挂载点 | 通用模式 | ✅ engine（AgentInvocationRequest + RunSupervisor 都加） |
| 显式 `parentConversationId` 字段 | Codex Conversation + Thread | ✅ engine（AgentInvocationRequest 加可选字段）|
| session_key 模板 / IM 平台标识 | Hermes | ❌ 产品语义，归 secretary |
| Conversation / Thread / Turn 三层抽象 | Codex | ❌ engine 已有 conversationId + RunHandle 两层就够 |

---

## 4. 候选方案

### 方案 A（推荐）：**conversationId 协议保持 opaque + 周边挂载点扩展**

**做什么**：

1. **`AgentInvocationRequest` 扩展**（向后兼容）：

   ```typescript
   export interface AgentInvocationRequest {
     // 现有字段全部不变
     query: string;
     promptKey: PromptKey;
     model_id?: string;
     imageGenerationModelId?: string;
     mode?: 'agent' | 'chat';
     maxSteps?: number;
     enableTools?: boolean;
     availableTools?: string[];
     conversationHistory?: AiMessage[];

     // 新增（全部可选，向后兼容）
     conversationId?: string;             // 显式传入；缺省由 host 生成
     parentConversationId?: string;       // 父子关系（engine 不解析，仅透传 + 持久化）
     parentRunId?: string;                // 与 RunSupervisor.spawnDetached opts 对齐
     metadata?: Record<string, unknown>;  // 产品语义自由挂载点
   }
   ```

2. **EngineState 不动**（`conversationId?: string` 已经够；`metadata` 不进 EngineState 内部，避免污染——通过 RunRecord / Checkpointer 周边查询）

3. **RunRecord 已经在 [`engine/06 §4 方案 A`](./06-checkpointer-and-persistence.md) 留了 `metadata: Record<string, unknown>`** —— 与本 topic 对齐（同一份元数据可在 RunSupervisor.peek / list 里查到）

4. **明确"engine 不解析 metadata"**：透传 + 持久化，仅此而已。产品层自定义结构，engine 不验证。

**优点**：
- 改动极小（接口加 4 个可选字段）
- 完全向后兼容
- 让上层有挂载点—— linnsec 可以塞 `{platform, chatType, chatId, originatorAgentId, ...}` 进 metadata
- engine 仍然 0 产品语义

**缺点**：无明显缺点

### 方案 B：**新增 `Conversation` 抽象 + `ConversationManager` port**

模仿 Codex `Conversation/Thread/Turn` 三层。

**优点**：能力强、显式。

**缺点**：
- 我们已经有 `conversationId + RunSupervisor + Checkpointer` 三层，**不需要再加一层**
- 引入大量 boilerplate
- 产品层都在用 conversationId，重命名成本大

→ 否决。

### 方案 C：**完全不动**

理由：协议已经够薄。

**缺点**：违反 §1.4 "信息丰富" 原则——上层做工具时找不到挂载点；linnsec 第一阶段开发时几乎肯定要回来加。

→ 否决。

---

## 5. 当前倾向

### 5.1 拍板小结

**走方案 A**：conversationId 保持 opaque + AgentInvocationRequest 加 4 个可选挂载字段。

### 5.2 实施分步

| Step | 内容 | 文件 | 风险 |
|------|------|------|------|
| 1 | `AgentInvocationRequest` 加 4 个可选字段（`conversationId` / `parentConversationId` / `parentRunId` / `metadata`）| `src/agent/ports/agent-invocation.ts` | 极低（纯类型扩展，向后兼容）|
| 2 | engine 入口（`InternalAgentInvoker` 等）把 `metadata` / `parentConversationId` / `parentRunId` 透传到 RunRecord（与 [`engine/06 §4`](./06-checkpointer-and-persistence.md) RunRecord 字段对齐）| `child-runs/internalAgentInvoker.ts` + `run-supervisor/*` | 低 |
| 3 | 文档：在 `runtime-kernel/README.md` / `INTEGRATION_GUIDE.md` 加"conversationId 协议契约"段落，明确 engine 不解析 metadata | docs | 必做 |

**总改动量预估**：≤ 50 行类型 + ≤ 80 行透传代码 + 1 段文档。

### 5.3 触发其他改动的可能性

| 改动 | 触发条件 |
|------|---------|
| `metadata` schema 治理（如 `WellKnownMetadataKeys` 推荐表）| 多产品都在 metadata 里塞类似字段、出现重复造轮 |
| 显式 `Conversation` 抽象 | YAGNI——目前 engine + RunSupervisor + Checkpointer 三层已够 |

---

## 6. 待决策问题（已逐项定稿）

> **2026-04-21 默认推荐定稿**：方案 A 全部按 §5 推荐定稿。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | `metadata` 字段类型？ | ✅ **`Record<string, unknown>`**（不强加 schema） | engine 不解析；产品层自定 |
| Q2 | `parentConversationId` vs `parentRunId` 是否冗余？ | ✅ **两者都留**（不冗余）| 一个 conversation 内可有多个 run；父子关系可以是 conversation 级或 run 级，由产品层选 |
| Q3 | engine 是否要校验 metadata 大小？ | ✅ **不校验**（产品层职责）| 信任产品层；engine 不立警察 |
| Q4 | conversationId 缺省时由谁生成？ | ✅ **host 生成**（engine 不强制 ID 算法） | 产品层可能用 UUID / nanoid / IM session_key 派生等不同策略 |
| Q5 | history 继承（来自 [`01 §6 Q6`](./01-async-runs-and-handles.md)）| ✅ **engine 不规定**（由 `AgentInvocationRequest.conversationHistory` 显式传入） | 灵活——产品层决定继承多少 |
| Q6 | `parentConversationId` 是否触发 engine 自动 history 继承？ | ✅ **否**（仅元数据，engine 不自动复制 history）| 自动继承会引入隐式行为；产品层可读 RunRecord 自己决定继承 |
| Q7 | 是否在 engine 提供 `WellKnownMetadataKeys` 推荐常量？ | ✅ **当前不提供**（YAGNI；触发条件：多产品 metadata 出现重复造轮）| 留给 secretary 共享包定义 |

---

## 7. 落地任务

### 7.1 Engine 内任务

- [ ] T1：扩展 `src/agent/ports/agent-invocation.ts` 加 4 个可选字段
- [ ] T2：`InternalAgentInvoker` 把 `metadata` / `parentConversationId` / `parentRunId` 透传到 RunRecord（与 engine/06 RunRecord 字段对齐）
- [ ] T3：协议级 contract 测试：`AgentInvocationRequest` 不传新字段时行为不变；传入时正确透传到 RunRecord

### 7.2 Host 侧任务（Linnya）

- [ ] T4：linnya 装配点确认 conversationId 由 host 生成（保持现状即可）
- [ ] T5：可选：在 metadata 里挂"产品语义"字段试水（如 `{ originatorView: 'main-chat', ... }`）

### 7.3 Linnsec 侧任务（不在 engine 范围）

- T6（linnsec 实施时）：定义自己的 metadata schema（`{ platform, chatType, chatId, originatorAgentId, ... }`）
- T7（linnsec 实施时）：session_key 模板归 `secretary/02-gateway-daemon.md`，与 engine 无关

### 7.4 文档任务

- [ ] T8：更新 `src/agent/runtime-kernel/README.md` 加 "conversationId 协议契约" 段落
- [ ] T9：更新 `src/agent/INTEGRATION_GUIDE.md`（D-3 接入指南撰写时）说明 metadata 挂载用法
- [ ] T10：更新 `00-engine-scope-audit.md` §4 把 02 状态同步为 "✅ 决策定稿，等候实施"

---

## 8. 状态

- [x] §0 边界判定通过 Q1-Q4
- [x] §1 用户场景明确（S1-S3）
- [x] §2 当前 Linnya 现状盘点完成
- [x] §3 参考项目启发汇总
- [x] §4 候选方案 + 取舍（方案 A 主路径 + B/C 否决）
- [x] §5 当前倾向（方案 A 分步 + 触发条件）
- [x] §6 7 题已逐项定稿
- [x] §7 落地任务展开 T1-T10
- [ ] 进入实施

**下一步**：
1. ✅ §6 决策已定（conversationId 保持 opaque + 4 个可选挂载字段）
2. T1-T3 engine 内实施（极小改动，低风险）
3. T4-T5 host 侧装配（linnya 默认行为不变）
4. T8-T10 文档同步
