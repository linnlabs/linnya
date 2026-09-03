# System Reminder

Layer: `runtime-kernel/system-reminder`

本模块拥有 Linnkit 的瞬态 `<system-reminder>` 控制协议、普通 tick 规则注册表与普通提醒注入。它不拥有上下文压缩计划、模型调用、历史事实或 Provider wire codec。

公开接入先读 [Context Engineering §6](../../../docs/integration/context-engineering.md#system-reminder)；本文记录维护本模块和 Graph 压缩接线时必须遵守的开发规范。

## 1. 两种 Reminder，共用标签但不共用位置

| 类型 | 产生者 | 物理位置 | 是否有独立 role | 生命周期 |
| --- | --- | --- | --- | --- |
| 普通 tick Reminder | `AgentSpec.contextPolicy.systemReminder` + registry | 当前最后一条 wire message 的 `content` 末尾 | 没有；继承末条消息的 role，末条可能是 user 或 tool | 仅当前 tick；该 tick 触发压缩时也随完整原 Prompt 进入内部请求 |
| 压缩专用 Reminder | Context Manager 提供正文，Graph compaction feature 组装请求 | 完整原 Prompt 之后新增的最后一条 wire message | 固定 `role=user` | 仅当前内部压缩调用 |

两者都使用：

```text
<system-reminder>
...
</system-reminder>
```

两者都不是 `AiMessage` 或 `RuntimeEvent`，不进入 history、EventStore、Conversation read model 或 Graph checkpoint。标签名称表达“运行时控制提醒”，不代表 wire role 是 `system`。

特别注意：durable `history_summary` 当前由 Context Manager 以 `role=system` 投放，这是压缩完成后的历史记忆投放策略；它不是压缩指令，也不是 System Reminder。不要把二者的 role 混为一谈。

## 2. 固定数据流

普通主调用：

```text
build_context
  → apply_system_reminder
  → measure_prompt_usage
  → compact_context（可选）
  → admit_prompt_capacity
  → commit_context_compaction（可选）
  → execute_llm
```

自动压缩：

```text
[普通 Reminder 已注入的完整原 Prompt，逐条不变]
[role=user: <system-reminder>压缩专用指令</system-reminder>]
  → 当前锁定模型，tool_choice=none
  → Context Manager 校验并重建
  → 重新运行普通 Reminder 规则
  → 重新计量与容量接纳
  → durable history_summary commit
  → 正式主调用
```

压缩专用 Reminder 必须位于新增的末尾 user message。禁止把它：

- 插入开头连续 system 区块；
- 构造成独立 `role=system` message；
- 拼进最后一个 `tool_output`；
- 写入 durable history；
- 带入压缩后的正式主调用。

这些限制同时保证控制优先级和完整原 Prompt 前缀。Provider adapter 只能做语义等价 wire 投影，不能改变这套 canonical 位置。

## 3. 目录职责

| 文件 | 职责 |
| --- | --- |
| `rules.ts` | 内置规则的稳定 ID 与声明顺序 |
| `triggers.ts` | package-neutral 触发器纯函数 |
| `templates.ts` | 内置与 host 文案模板 |
| `registry.ts` | trigger/template 注册与规则构造 |
| `types.ts` | 规则、上下文和模板合同 |
| `format.ts` | 统一标签格式；package 内部使用，不是公共 API |
| `apply.ts` | 解释规则，并把普通 tick Reminder 拼入末条 content |

压缩专用消息的位置属于 `graph-engine/features/context-compaction/`，不应塞进普通 `applySystemReminders()`。Graph 只复用本模块的标签格式，Context Manager 仍只负责压缩候选、固定格式校验与重建。

## 4. 扩展规范

1. Agent 只在 `contextPolicy.systemReminder` 中声明 rule/template ID 和可序列化参数，不能注入函数。
2. 通用 trigger/template 才能进入 Linnkit；TaskState、Workspace 等产品文案留在 Host 注册表。
3. 内置规则与 Host extra rules 走同一 registry、顺序与去重逻辑。
4. 规则必须是纯函数。规则异常只影响该规则，不得创建另一条持久化或 fallback 通道。
5. 新增新的物理注入形态前，必须先修改本 README 与接入文档，明确 role、位置、生命周期和 owner；不得复用普通注入函数隐藏语义差异。
6. 不要把内部 formatter 或注入细节加入公共 namespace。新增公开 API 必须按 Linnkit 版本和 exports 规范评审。

## 5. 验证

修改普通 Reminder 至少运行：

- `packages/linnkit/src/runtime-kernel/system-reminder/__tests__/apply.test.ts`
- `packages/linnkit/src/runtime-kernel/graph-engine/__tests__/graph-agent-executor.context-compaction.test.ts`

修改压缩 Reminder、canonical request 或 Provider 投影还必须运行仓库级：

```text
pnpm run test:context-compaction-gate
```

该门禁同时覆盖 Context Manager、Graph、root/child、Host durable commit、Renderer、Provider conformance 和旧压缩机制零基线。

## 6. 相关文档

- [Context Engineering](../../../docs/integration/context-engineering.md)
- [Agent Registration Guide](../../../docs/integration/agent-registration-guide.md)
- [Graph Engine](../graph-engine/README.md)
- [Linnkit Development Guide](../../../docs/DEVELOPMENT_GUIDE.md)
