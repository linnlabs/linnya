# Prompt Key 一次性统一改造方案（不过度限制版）

## 背景与目标

当前 `promptKey` 在仓库内存在多源定义（`PromptKeys`、`@app/schemas` 常量、字符串字面量、局部默认值），可运行但维护成本高，且容易出现“值一致但来源不一致”的问题。

本方案目标是：

- 一次性完成统一，不走“逐步下线”；
- 统一类型与常量来源，减少重复定义；
- 保持工程简单，不做过度限制；
- **明确接受**：`internal key` 可以被前端使用（业务上通常不会误用，且测试/调试可快速发现）。

---

## 当前现状（基于仓库代码的事实）

### 1) 现有 key 的定义是“多源并存”

- 后端权威集合在 `src/app-hosts/linnya/agent-registry/prompt.types.ts`：包含 `deep_research_*`、`mindmap_*`、`subagent_*`、`deep_search`、`pdf_ocr`、`image_description`、`knowledge_graph_extraction` 等。
- 共享包在 `packages/schemas/src/agent-config/index.ts`：目前仅覆盖一部分（`default/writing/annotation/autocomplete/table_ai_fill/agent_default/review/project_planning/translation/audio_summary`）。
- 同时存在大量字符串字面量与局部常量（如 `'default'`、`'review'`、`'autocomplete'`、`'deep_research_leader'`）。

这导致“可运行，但来源不统一”。

### 2) 运行时并不依赖 `packages/schemas` 的 key 注册

- agent 查找基于 runtime-gated `AgentDefinitionResolver`；`agent-registry/agents/index.ts` 只保留测试/诊断快照。
- chat 查找基于 `src/app-hosts/linnya/agent-registry/chats/index.ts` 的 `ALL_CHAT_DEFINITIONS`。
- 也就是说：**只要 definition 被聚合导入，就能运行；不要求写进 `packages/schemas`**。

### 3) “没写进包里也正常”的直接原因

- 前端可以直接传字符串 `promptKey`（例如 `deep_research_leader`）。
- 多处 schema 对 `promptKey` 使用 `z.string()`，没有值域约束。
- 任务分发链路有 fallback（未知 key 回退 default），历史上会掩盖一部分问题。

### 4) 默认值与约定存在分散

- agent 侧默认值常见为 `'agent_default'`；
- chat / dto 侧默认值常见为 `'default'`；
- 默认值定义分散在多个文件，长期有漂移风险。

### 5) internal key 的实际情况

- internal key 已在仓库内被明确使用（如 `pdf_ocr`、`image_description`、`knowledge_graph_extraction`）。
- 按当前业务判断，前端通常不会错误使用；即使误用，也可通过测试+调试快速暴露。
- 因此本方案不做复杂权限限制，保持使用面简单透明。

---

## 设计原则（按当前团队偏好）

- **单一真源优先**：`PromptKeys` 与 `PromptKey` 类型只保留一处权威定义。
- **工程一致性优先**：前后端都 import 同一来源，避免“同值多定义”。
- **不过度约束**：不把 key 分成过多权限层级；不强行禁止 internal key 前端传入。
- **问题快速暴露**：依赖测试、调试日志与运行链路可观测性，而不是复杂权限网。
- **一次性交付**：同一分支内完成所有核心改动并一次合并。

---

## 统一后的目标形态

### 1) Key 与类型唯一来源

建议把 `PromptKeys` 与 `PromptKey` 放在 `packages/schemas/src/agent-config/index.ts`，作为前后端共享权威来源。

统一后：

- 后端 `src/app-hosts/linnya/agent-registry/prompt.types.ts` 不再维护独立 key 集合；
- 前端不再维护另一套同义 `*_PROMPT_KEY` 分散常量；
- 业务代码统一 `import { PromptKeys } from '@app/schemas'`。

### 2) 使用策略（简单版）

- 所有 key（包括 internal key）允许作为 `promptKey` 值传递；
- 不增加额外“白名单权限层”；
- 通过类型收口 + 测试链路保证正确使用。

### 3) 运行时行为

- 查找不到定义时不再静默回退 `default`；
- 直接抛错并记录关键信息（`promptKey`、mode、入口上下文），便于第一时间定位；
- 保留必要调试日志，减少“猜测式排查”。

---

## 一次性改造范围（文件级）

以下为建议一次性改造清单（按模块）：

### A. 共享 schema 层（单一真源）

- `packages/schemas/src/agent-config/index.ts`
  - 升级为统一导出：`PromptKeys`、`PromptKey`（`as const` + 推导类型）。
  - 将当前后端已有 key 一次性完整收编进 `PromptKeys`（包含 deep_research/mindmap/internal 等全部 key）。
  - 保留兼容导出别名（如 `DEFAULT_PROMPT_KEY`）仅作为 `PromptKeys.DEFAULT` 的映射，禁止再次手写重复值。
- `packages/schemas/src/index.ts`
  - 统一从 `agent-config/index.ts` 转发导出。
  - 保留对外 API 稳定（旧导出名可继续可用，但内部来源必须唯一）。

### B. 后端 registry 与类型层

- `src/app-hosts/linnya/agent-registry/prompt.types.ts`
  - 移除本地 key 真源定义，改为引用 `@app/schemas`。
  - 保留 `PromptType`、`PromptTemplate`、`PromptTemplateSchema` 等与 key 无关的结构。
- `src/app-hosts/linnya/agent-registry/types.ts`
  - `AgentDefinition.promptKey` 绑定统一 `PromptKey` 类型。
- `src/app-hosts/linnya/agent-registry/chats/types.ts`
  - `ChatDefinition.promptKey` 从 `string` 收口到统一 `PromptKey` 类型。
- `src/app-hosts/linnya/agent-registry/agents/**/index.ts`
- `src/app-hosts/linnya/agent-registry/chats/**/index.ts`
  - 去除字符串字面量，统一使用 `PromptKeys.xxx`。
  - 同步修正 `id` 与 `promptKey` 的一致性（避免 `id='x'` 但 `promptKey='y'` 的隐患）。

### C. 请求 schema 层

- `packages/schemas/src/api-dtos.ts`
- `src/features/context-manager/agent/schemas.ts`
- `src/features/context-manager/chat/schemas.ts`
  - `promptKey` 从宽泛 `z.string()` 收口到基于统一 key 集合的 schema（来自同一真源）。
  - 默认值统一引用 `PromptKeys`，避免不同文件各写一份 `'default'` / `'agent_default'`。
  - 保留 internal key 可传的能力，不引入“按来源限制”策略。

### D. 运行时分发链路

- `src/features/context-manager/agent/tasks/index.ts`
- `src/features/context-manager/chat/tasks/index.ts`
- `src/features/conversation/flow/services/flow.history-builder.service.ts`
  - 去掉“未知 key 自动 fallback default”；
  - 改为明确报错 + 结构化日志。
  - 日志字段建议至少包含：`promptKey`、`mode`、`conversationId`、`source`（调用入口）。

### E. 前端调用入口

- `apps/renderer/**` 中所有 `promptKey: 'xxx'` 改为 `PromptKeys.xxx`。
- 重点包括但不限于：
  - `apps/renderer/domains/conversation/ui/AiAssistantInput.vue`
  - `apps/renderer/domains/conversation/services/assistantService.ts`
  - `apps/renderer/shared/services/aiService/common.js`
  - 各功能调用入口（ProjectPlanning / Review / Table / AutoComplete / Audio 等）

### F. 文档与约定

- `src/app-hosts/linnya/agent-registry/README.md`
  - 更新“新增 key 与新增 agent”的统一流程，删除旧描述中容易引发双维护的表述。

---

## 详细改造动作（按任务包拆分）

> 下面是实际执行时建议的“任务包”，每个任务包都应在同一次改造内完成，不拆上线。

### 任务包 1：真源收口（schemas）

- 新建/调整统一结构：
  - `PromptKeys`（完整全集）
  - `PromptKey`（值联合类型）
  - 兼容别名常量映射（不再重复字面量）
- 产出后立即替换 `packages/schemas/src/index.ts` 的导出方式，确保外部入口稳定。

### 任务包 2：后端类型替换（registry + definitions）

- `agent-registry/prompt.types.ts` 去掉本地 key 真源，防止再次分叉。
- `AgentDefinition` / `ChatDefinition` 的 `promptKey` 全量改为统一类型。
- `agents/chats` 各目录 `index.ts` 完成字面量替换。
- 同步排查 `task.ts` 中本地 `const XXX_PROMPT_KEY = 'xxx'`，能删则删，统一引用 `PromptKeys`。

### 任务包 3：请求 schema 收口

- 三处 schema 全部改为同一来源的 key schema。
- 清理散落默认值常量（不再各模块自定义 `'default'`/`'agent_default'`）。
- 保持 external API 字段名不变，只调整值校验和默认值来源。

### 任务包 4：分发行为收口（去 fallback）

- agent/chat task registry 去掉 fallback，未命中直接异常。
- history-builder 中 `findXxx(...) || findXxx('default')` 统一改为显式失败。
- 对未知 key 的错误信息统一格式，便于日志检索。

### 任务包 5：前端入口统一

- 逐模块替换 `promptKey` 字面量为 `PromptKeys`：
  - conversation（输入框、编排、assistant service）
  - editor（autocomplete、annotation、table、audio）
  - workspace/project setup
- 维持现有业务逻辑不变，仅做 key 来源统一。

### 任务包 6：文档与防回归

- 更新 `agent-registry/README.md` 中“新增 key / 新增 agent/chat”的步骤。
- 新增检索式检查（开发约定）：
  - 非测试目录中新增 `promptKey: 'xxx'` 必须视为违规。
  - 新增 key 只能在真源文件定义。

---

## 实施顺序（一次性合并内的工作顺序）

> 注意：这是同一次改造内的开发顺序，不是分阶段上线策略。

1. 先收口 `@app/schemas` 的 `PromptKeys` / `PromptKey`；
2. 再改后端 `agent-registry` 类型与 definitions；
3. 再改三处请求 schema；
4. 再改运行时 fallback 逻辑；
5. 最后改前端所有入口与文档；
6. 一次性跑完整验证后合并。

---

## 验收标准

- 仓库内不存在“第二套 key 真源”（允许别名映射，但不得重复写值）；
- 业务代码中 `promptKey` 字面量显著收敛（仅测试 fixture 可例外）；
- unknown key 不再静默走 default；
- 前后端关键链路通过（chat / agent / review / deep research / table fill / project planning）；
- 现有测试通过，新增/更新用例覆盖统一后的 key 使用方式。

### 验收检查建议（可执行）

- 代码检索：
  - `promptKey: '...` 在业务目录应为 0（测试除外）。
  - `z.string().default('default')` / `z.string().default('agent_default')` 不再用于 `promptKey`。
- 行为检查：
  - 传入不存在的 key 时，应直接报错，不再走 default。
  - 关键功能场景可完整跑通并得到预期输出。
- 文档检查：
  - `README` 与本方案一致，不再出现“双处维护 key”描述。

---

## 风险与应对

### 风险 1：一次性大改编译报错较多

- **应对**：先做类型真源收口，让编译器暴露所有引用点，再批量修复。

### 风险 2：去 fallback 后暴露历史隐性问题

- **应对**：保留详细日志字段，失败即定位；在回归测试中优先覆盖常用业务入口。

### 风险 3：internal key 被误用

- **应对**：不做复杂权限限制；依赖业务测试与调试快速发现，保持系统简单透明。

---

## 结论

本方案强调“**一次性统一** + **不过度限制**”：

- 统一来源、统一类型、统一调用方式；
- 不额外引入复杂权限模型；
- internal key 保持可用；
- 通过工程一致性与测试体系保障正确性。

如果采用该方案，下一步可直接按本文件清单执行代码改造并提交单个统一 PR。
