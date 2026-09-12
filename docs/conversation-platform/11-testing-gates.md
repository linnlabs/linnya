# 11 · 测试与门禁

> **What** · 哪一层测试能证明什么、必跑门禁清单、guard 机制、以及"绿灯不等于可用"的判定标准。
> **When to read** · 提 PR 前、设计新测试前、想用组件测试替代真机门禁时。
> **不变量** · [INV-50](./00-invariants.md#inv-50--业务门禁必须穿过生产实现)、[INV-51](./00-invariants.md#inv-51--导航时序回归必须真机)、[INV-52](./00-invariants.md#inv-52--parity-fixture-同-pr-锁一致)、[INV-53](./00-invariants.md#inv-53--测试装配不能拥有另一套协议)、[INV-54](./00-invariants.md#inv-54--parse-与-throw-只允许在-admission-边界)
> **Related** · [00 不变量](./00-invariants.md) · [04 schema](./04-schema-contract.md) · [12 风险与冻结区](./12-open-risks.md)

---

## 1. 测试分层：每层能证明什么

| 层 | 能证明 | **不能**证明 |
|---|---|---|
| schema 单测 | 合同语义、非法组合被拒 | 生产链路调用了它 |
| 纯函数单测 | 规则正确 | 规则被正确接入 |
| store / 投影业务测试 | 状态机在给定事件序列下正确 | DOM、滚动、第三方库行为 |
| 组件测试（jsdom） | 结构存在性、props 传递 | 真实布局、Teleport、滚动库、虚拟列表 |
| **真机 Electron E2E** | 导航时序、DOM 生命周期、第三方库协作 | 全部业务分支 |

**核心判定**：一个测试如果 mock 掉了它要验证的机制，它就不构成门禁。

> 教训 2：合成 gate 全绿 ≠ 生产可用。正式放行必须真实 Electron 宿主 + 三类真实会话（5000 条无图 / 16 图 / 任务型）；合成夹具永久降级为库回归。

### 1.1 一个真实的反例

现位于 `apps/renderer/app/layout/__tests__/overlayScrollAdoption.spec.ts` 的结构测试，迁移前曾对 Host
常驻方案全绿，而生产环境完全不可用。原因：

```ts
vi.mock('@linnya/renderer-ui/scroll', ...)            // 滚动能力被 mock
vi.mock('.../ConversationView.vue', ...)              // 虚拟列表被 stub
vi.mock('.../AiAssistantInput.vue', ...)              // 输入区被 stub
vi.mock('.../components/ErrorBanner.vue', ...)
```

它断言的是 `container.querySelector('.conversation-chat-host') !== null`——**元素存在性**，而非"`v-show` 是否真的隐藏了它"、"虚拟列表是否安全卸载"。真实故障发生在被 stub 掉的那三个组件与真实 OverlayScrollbars 的交互中（详见 [08 §2.1](./08-lifecycle.md)）。

**结论**：组件测试可以留作结构回归，但**不能**作为 DOM 生命周期的放行依据。

---

## 2. 必跑门禁

### 2.1 涉及导航 / Host / 虚拟列表 / Teleport / OverlayScrollbars（[INV-51](./00-invariants.md#inv-51--导航时序回归必须真机)）

```bash
pnpm run test:conversation-navigation:electron
```

命令会先用当前源码重建 inline `app-server-backend.cjs`，再启动**真实 Electron DOM**。不得直接运行底层 `.mjs` 跳过构建；旧 App Server bundle 会让 Renderer 与 Host 使用不同版本的 strict schema，使门禁产生假结果。

覆盖：

- A/B 会话切换
- 新草稿进入与返回历史会话
- 打开项目文件工作区后将会话切到右侧，验证 `side-pane` 使用历史空态视觉、regular 输入框位于底部 footer、没有 compact 根类、全页只有一个输入框，以及 Host 原子卸载/恢复
- 主区 / 右侧互换时，从 store 重建 Tiptap 并保留未发送草稿文字
- 正常 chunk 在 **50 ms pending commit 期间**切换 / 新建
- 后台 terminal seal
- 严格协议失败挂载 ErrorBanner 后**继续导航**
- 隔离 SQLite 的 Subrun durable decision/output/final answer 在无 ephemeral process/chunk 时恢复真实 child tool 与完整正文
- 父进度卡进入 Host 就地详情后 Header 显示 `父对话标题 / Subrun 标题`、正文不重复标题、切会话销毁 detail scope 与子标题、再次进入后返回精确父消息锚点
- 父列表重挂载复用 exact trace ready 快照，不因重复历史请求改变 virtual row 首帧高度
- renderer 无异常（无未捕获错误）

脚本：`scripts/e2e/conversation-navigation/run-electron-conversation-navigation-e2e.mjs`。

**mock 滚动库或 stub `ConversationView` 的组件测试不能替代它。**

### 2.1.1 Agent 执行期间的响应性门禁

`test:conversation-navigation:electron` 与人工前端验收已经证明 App Server cutover 后的导航、输入、滚动、命令卡和退出语义没有功能回归，但它们不自动产生量化性能结论。完整响应性基线必须在真实 Electron 中并发运行 Command 高输出/持续写盘、Slides build 和后台 Worker，并连续执行输入、选择复制、滚动、切换会话、展开命令卡、审批、PTY、取消与窗口 resize。

当前量化目标：

- `tool_process(start)` 到现有命令卡片活动态：p95 ≤ 100ms、p99 ≤ 250ms；
- runner/Worker 收到请求到 spawn/ready acknowledgement：p99 ≤ 250ms；
- terminal 事实产生到 UI 显示：p95 ≤ 250ms、p99 ≤ 500ms；
- 用户点击取消到 owner 收到控制消息：p95 ≤ 100ms；点击取消到进程树归零：p95 ≤ 2s、maximum ≤ 5s；
- Electron Main event-loop delay：p99 ≤ 25ms、单窗 maximum ≤ 100ms；
- App Server event-loop delay：p99 ≤ 50ms、单窗 maximum ≤ 200ms；
- Renderer input-to-paint：p95 ≤ 50ms、p99 ≤ 100ms、maximum ≤ 250ms；
- 组合场景中不得出现输入丢失、焦点跳转、滚动锚点破坏、卡片状态错乱、PTY 控制失效或额外 App/窗口身份。

Main 与 App Server 已有正式 event-loop monitor；Renderer input-to-paint、long task、rAF gap、跨边界 RTT 和上述组合 workload 仍需收成可重复 fixture。fixture metadata 必须记录硬件、操作系统和电源状态，首轮数据允许校准工程阈值，但不能增加“高性能模式”或放宽前端零回归合同。完成前，人工验收可以确认当前体验可接受，但不能把功能 E2E、单进程采样或平均耗时写成量化门禁已完成。该剩余项登记为性能风险基线 `F6-01`。

只修改右侧新对话空态、底部 composer 或主区/右侧草稿重建时，可先运行专用真机场景快速定位；最终合入前仍应运行上面的完整导航门禁：

```bash
pnpm run test:conversation-side-pane-draft:electron
```

仅修改 Subrun 紧凑历史、完整 child message admission 或详情重载协议时，还必须运行专用真机场景：

```bash
pnpm run test:conversation-subrun-reload:electron
```

该场景从隔离 SQLite 只持久化 durable decision/output/final answer，不伪造 ephemeral process/chunk，并断言详情同时恢复真实 child tool 与完整答案、没有 presentation admission 错误。它缩短无关的父时间线，但仍穿过真实 Electron、HTTP、Renderer registry 与 message admission；因此不会把协议回归误归因到长列表滚动时序。

修改用户消息复制反馈或虚拟 row 内的复制按钮时，还要运行专用场景：

```bash
pnpm run test:user-message-copy:electron
```

该场景复用同一套隔离 SQLite 与真实 Electron 宿主，通过 CDP 发送真实鼠标事件，依次点击用户气泡右下角与助手回答操作区的复制按钮，验证剪贴板写入后的反馈显示、定时复位以及 renderer 全程无异常。JavaScript `element.click()` 不具备剪贴板所需的真实用户激活，不能替代这里的鼠标输入。

### 2.2 合同 guard

```bash
pnpm run guard:conversation-contract
```

`scripts/guards/conversation-contract-guard.mjs` 做的是**存在性断言**：对每个权威文件检查关键 token 仍在其中，例如

| 文件 | 必须包含 |
|---|---|
| `packages/schemas/src/json-value.ts` | `JsonValueSchema` / `JsonRecordSchema` |
| `conversation/message-identity.ts` | `conversationMessageIdFromAnswerId` / `conversationMessageIdFromToolIdentity` / `run_id + tool_call_id` |
| `conversation/message-metadata.ts` | `ConversationMessageExtensionSchema` / `ConversationAnswerMessageMetadataSchema` / `parseConversationAnswerMessageMetadata` |
| `conversation/tool-message.ts` | `ConversationToolMessageMetadataSchema` / 各 interaction variant / `loading tool message must not have completed_at` |
| `conversation/ui-message.ts` | `message_type` / `ConversationUiMessageSchema` |
| `types/index.ts` | variant 类型绑定 |
| `mapUiMessageDto.ts` | DTO 映射入口 |

它防的是**静默删除**：有人为了让代码通过而移除一个 schema、一个派生函数或一条校验消息时立即失败。它**不**验证语义正确——语义靠业务测试。

### 2.3 域内测试

```bash
pnpm exec vitest run apps/renderer/domains/conversation packages/schemas
```

### 2.3.1 Linnya Conversation CLI

CLI 当前是开发、评测与 Benchmark 使用的薄进程入口，尚未作为生产功能分发；但它连接的是正式 Host 控制流程，测试不能只锁参数字符串。日常变更至少运行：

```bash
pnpm typecheck:linnya-cli
pnpm test:linnya-cli
pnpm build:linnya-cli
```

`test:linnya-cli` 同时覆盖 parser/orchestration 与真实 Node 子进程：子进程通过私有连接描述连接脚本化 HTTP bridge，验证单值 JSON、watch JSONL、stderr、退出码、App 不在线、Host busy 和可选能力缺失。它证明 CLI 进程合同，但不能单独证明 Host 主链。

涉及 CLI wire、workflow、鉴权或连接生命周期时，还必须运行：

```bash
pnpm exec vitest run \
  packages/schemas/src/conversation-control/conversation-control.test.ts \
  src/app-hosts/linnya/application/conversation-control/__tests__/conversationControlUseCase.integration.test.ts \
  src/app-hosts/linnya/adapters/conversation-control-bridge/__tests__ \
  src/electron-main/services/apiServer.test.ts \
  src/electron-main/services/apiServer.lifecycle.test.ts
```

分层判定：

| 证据 | 能证明 | 不能证明 |
| --- | --- | --- |
| parser / schema | 参数和 wire 严格 | 实际 bridge 或运行执行 |
| 子进程 + scripted bridge | CLI I/O、连接、watch、退出码 | Linnya Flow、数据库和模型 |
| workflow + ApiServer 集成 | durable acceptance、exact paused-run resume、状态/取消/HITL/结果语义、token 与 descriptor 生命周期 | 真实 Provider 和 Slides 工具产物 |
| 运行中 App smoke | 当前模型配置、Agent、工具与产物真实可用 | 所有错误分支 |

涉及 CLI/Host 控制流程的开发版本在合入前至少用运行中的 App 执行一次短任务；Slides 验收应使用 `slides_agent` 生成 3 页 PPT，保存 `conversation_id + run_id`，关闭首次 CLI 进程后继续 watch，按需 respond，最后用 exact run 读取 result。另跑一次 settled pause 的 `resume --run` 和运行中的 `stop --run`，分别验证原 run continuation 与真实 terminal settlement。完整操作见 [`apps/linnya-cli/README.md`](../../apps/linnya-cli/README.md)。Benchmark 必须调用 CLI 子进程并解析 JSON/JSONL，不得复制 bridge 或直读数据库。

### 2.4 `conversation.messages` 写入 guard（[INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源)）

```bash
pnpm run guard:conversation-messages-write
```

`scripts/guards/conversation-messages-write-guard.ts` 与 §2.2 的存在性 guard 不同——它做的是**写入边界断言**，用 TypeScript AST 而非正则：

| 规则 | 拦截 |
|---|---|
| `CONV-MSG-01-assign` | `conv.messages = [...]`、`conv.messages[i] = x`、复合赋值与自增 |
| `CONV-MSG-02-mutate` | `push` / `pop` / `shift` / `unshift` / `splice` / `sort` / `reverse` / `fill` / `copyWithin` |
| `CONV-MSG-03-length` | `conv.messages.length = 0` 截断 |

会穿透 `as T`、`!` 与括号包装，并解析 `.vue` 的 `<script>` 块（报告 SFC 真实行号）。

这是**语法边界**，不是类型推断：Conversation 域内 `.messages` 是 Conversation 消息缓存的保留属性名。其它概念不得在本域定义可变的 `.messages` 数组；需要表达诊断、提示等集合时，应使用其真实业务名称。这样可以覆盖 `.vue` 与普通 TypeScript，而不引入第二套依赖虚拟 SFC 类型环境的检查器。

**允许范围**只有两处，由 `conversation-messages-write-allowlist.ts` 按语义维护：

```text
services/messageProjection/**                      reducer 隔离工作区（普通 JS 对象）
services/orchestration/projectionCommitPipeline.ts Vue live slot 的唯一提交出口
```

测试与夹具整体排除。**不接受为了让某个业务文件通过而追加白名单条目**——需要写 messages 说明该走投影系统（如 `truncateProjectionStateAfterMessage()`）。

它不误报读取（`map` / 展开 / `length` 读）与会话实体 upsert（`conversations[i] = conversation`）。

### 2.5 其它相关 guard

| 命令 | 防什么 |
|---|---|
| `pnpm run guard:backend-dom-runtime` | 后端代码引入 DOM |
| `pnpm run guard:worker-bundle` | worker bundle 引入 Electron runtime |
| `pnpm run guard:task-naming`（`task-naming-guard.ts`） | `task` 命名滥用 |
| `pnpm run guard:conversation-types-exports` | R-13 历史 `types/index.ts` 公开符号新增或隐式 `export *` |
| `pnpm run guard:conversation-agent-choice-naming` | INV-55 旧 agent-choice `workflow` 命名继续扩张 |
| `pnpm run guard:conversation-agent-control-plane` | INV-16/55：`metadata.promptKey` 或 agent-choice contribution 的 `promptKey` 恢复隐藏控制面 |
| `pnpm run guard:conversation-tool-presentation` | INV-56 已迁移工具卡重新声明/读取 raw payload，或恢复组件内 parse/throw |
| `pnpm run guard:conversation-vue-reactive-boundary` | INV-17/54：Conversation 生产 Vue/TS 响应式层恢复 schema parse，或 reactive callback 及其本地同步调用重新抛业务错误 |
| `pnpm run guard:runtime-identity-assertion` | INV-58：生产代码通过 `as RunId / ToolCallId` 或核心载体断言绕过身份 admission |
| `pnpm run guard:context-compaction-legacy` | 已删除的 checkpoint 工具、step reset、预算提醒或专用摘要模型字段重新进入生产源码 |
| `pnpm run test:context-compaction-gate` | 自动压缩的 root/child 隔离、取消传播、durable-before-fanout、live/reload、Provider wire、审计与旧机制零基线回退 |
| `pnpm run guard:conversation-contract` | INV-57 执行合同混入展示配置，或 durable tool row 开始持久化派生 presentation |
| `pnpm run guard:tsc-baseline`（`.baseline/typescript-errors.txt`） | 全仓存量类型错误总数回退；不能代替 owner 严格 typecheck |

`guard:conversation-types-exports` 按 TypeScript AST 读取**实际导出符号**，不是统计 `export` 行数。迁移删除符号后运行 `pnpm run guard:conversation-types-exports:update`；该命令只会删除 baseline 中已消失的符号，发现新增或改名仍然失败。

`guard:conversation-agent-choice-naming` 同样使用 TypeScript AST，但不全仓禁用 `workflow`。旧
`ConversationWorkflow* / conversationWorkflow*`、相关文件名和 agent invocation 语境里的
`workflowId` 已清零，baseline 现在是零；未来真正可注册、可配置的显式 workflow 产品不在禁区。

`guard:conversation-agent-control-plane` 检查两类回流：`AGENT-CONTROL-01` 拦截属性访问、可选链、
方括号、解构、对象字面量与 metadata merge 中的 `promptKey`；`AGENT-CONTROL-02` 拦截
`conversationAgentChoices` contribution 重新声明 `promptKey`。它不误伤 one-shot 调用和 subrun
worker 的内部执行键。该 guard 与命名 guard 分工明确：前者锁字段所有权，后者锁业务概念命名。

`guard:conversation-tool-presentation` 用 TypeScript AST 检查两类迁移清单：`.baseline/conversation-tool-presentation-cards.txt` 锁实体卡只能接收 presentation；`.baseline/conversation-tool-presentation-header-only.txt` 锁共享空内容组件的注册项必须声明 projector 且不得恢复 raw title resolver。实体卡清单必须同时包含插件完整 `SubrunCard`、Host 父进度 `SubrunProgressCard` 与 batch adapter `SubrunBatchCollection`，不能把 child-run 展示误记为“迁移面为零”；它们与 Questionnaire、Document、Knowledge、TaskState、AgentTodo、ToolOutputRead、WorkspaceDocumentView、Web、Skill、ImageGeneration、SharedMemory 等正式卡共同受 AST 门禁。header-only 清单包含 live 项 `list_files / read_file / write_file / edit_file / grep / assemble_documents / evidence_resolve` 和历史只读 `assemble_evidence`。后续新增工具仍必须进入对应清单；产品正式退役则必须在同一切片同步删除注册、组件、测试、清单和 baseline。未同步 baseline 的删除或恢复 raw payload 都会失败；全域 reactive parse/throw 由下一条独立 guard 负责。

`guard:conversation-vue-reactive-boundary` 扫描 Conversation 生产 `.vue` 与 `.ts`：`.vue` 中禁止任何 Zod schema `parse/safeParse`；两类文件都追踪 `computed/watch/watchEffect` 回调同步调用的本地函数，阻止 schema admission 与业务 `throw` 回流 reactive effect。它不拦普通点击/下载动作中的显式失败，也不把 `JSON.parse` 误判为 schema admission。跨文件调用仍由评审与类型边界保证；不得用白名单绕过。

`guard:runtime-identity-assertion` 扫描 Linnkit、Host 与 Renderer 生产 TypeScript/Vue，禁止直接断言 `RunId / ToolCallId`，并禁止把未知值整体断言成 `RuntimeEvent / RoutedRuntimeEvent / SSEEvent / RunRecord / RunMeta / StandardToolCall` 间接取得 brand。测试和 testkit 在各自 admission fixture 中构造身份，不属于生产扫描范围；生产代码没有白名单。

`guard:context-compaction-legacy` 扫描 Linnkit、Host、Renderer、Schema、插件与 Cloud 的生产源码，保持旧压缩机制零基线。它不禁止仍在使用的 Engine Checkpointer，也不会把 `tool_history_compression` 误判为已删除的专用摘要模型目的。

`test:context-compaction-gate` 是自动压缩的业务门禁。它先执行上述零基线 guard，再贯穿 Context Manager 计划、Graph 同轮事务、root/child run 隔离与取消、Host durable commit、Renderer live/reload、Provider codec、Conversation audit、CLI 和 Benchmark 报告。真实模型长任务与真实路由缓存仍是显式验收，不进入普通 CI。

### 2.5.1 Conversation 文件链接真机门禁

`pnpm run test:conversation-resource-link:electron` 使用真实 SQLite、preload、IPC、Electron shell 与
Renderer。它验证 Workspace 链接使用 owner 真实标题并进入应用内文档，以及 `conversation:` / `file:`
普通文件通过系统文件管理器定位。组件 mock、直接调用 port 或浏览器内修改 `window.electronAPI` 都不能
替代该门禁。改动 Markdown link dispatch、文件 locator、conversation work-directory admission、preload
或 workspace navigation 时必须运行。

### 2.6 Conversation 语义门

```bash
pnpm run test:conversation-semantic-gate
```

该命令只运行约三秒的核心业务集合，已接入本地 pre-commit 与 CI：

- 前后端 UI projection parity
- RuntimeEvent parity 覆盖完整性
- 同会话并发 run 隔离
- wait-user 提交与投影
- history reload / buffered replay
- window/live 消息类型与 answer seal 的双向 admission、sealed dominance 与 reducer 回滚
- 工具 presentation 的 live/reload/Subrun 三入口一致性，以及 projector 失败时 tool message/toolState 或 child 快照不半写入
- Subrun decision 批次的 Runtime→SSE 无损投影、durable final answer 快照的历史 chunk 规范化、ready 快照跨 surface 复用、父 virtual row 轻量展示与详情完整 child message admission
- TaskState / AgentTodo / ToolOutputRead / WorkspaceDocumentView / WebSearch / SharedMemory list/read/write 及 Workspace list/grep projector 的 lifecycle 分支、strict success admission、wrapper 来源一致性、延迟本地化标题与迁移 AST 门禁
- 非工具消息不在 Vue reactive 层解析协议或抛业务错误；Thought 完成态、Summary 类型与 `user_quote` 严格合同由 schema/admission 保证
- agent 选择不经 Conversation metadata 或 contribution `promptKey` 建立隐藏控制面
- admission 失败后的 selector 求值、会话切换与新建

它不是全量 Conversation 测试，也不能替代真机导航 E2E；作用是让高频合同与数据流回归在提交前快速失败。

### 2.7 Renderer 工具双展示合同门禁

平台与官方插件的 backend manifest 必须和 enabled Renderer registry 同时核对：

```bash
pnpm exec vitest run \
  apps/renderer/app/plugins/builtin/platform.renderer.test.ts \
  src/app-hosts/linnya/plugin-registry/__tests__/official-plugin-tool-cards-contract.test.ts \
  apps/renderer/app/plugins/registry.test.ts
```

门禁要求每个 live executable 的最终非 alias config 都声明 `presentation + compactStep`，并禁止恢复
raw `title(args, result)` resolver。registry 测试还必须覆盖插件启用/停用后的贡献收缩；未加载插件与未知
工具可以走通用诊断标题，已注册 projector 的协议错误不能被该回退吞掉。

修改紧凑标题或 Subrun 父卡 admission 时，还要运行对应 owner projector、批次原子失败和真实父 virtual
row 集成测试；修改 durable replay 链路时按 §2.1 再运行 `test:conversation-subrun-reload:electron`。

---

## 3. 业务门禁必须穿过生产实现（[INV-50](./00-invariants.md#inv-50--业务门禁必须穿过生产实现)）

涉及 durable UI read model 的改动**至少使用真实 `SQLiteEventStore`**，并同时断言四件事：

```text
1. committed Runtime fact
2. SQLite UI row
3. live SSE
4. reload DTO
```

**不足以证明主链正确的做法**：

| 做法 | 为什么不够 |
|---|---|
| 只用 `MemoryEventStore` | 不覆盖 SQL、迁移、索引、事务 |
| mock persistence port | 不覆盖真实写入路径 |
| 字段快照 | 只锁形状，不锁行为 |
| 只验证路由命中 | 不证明 payload 合同一致 |
| 哨兵 JSON | 同上（[09 §7](./09-tools.md)） |

---

## 4. Parity fixture（[INV-52](./00-invariants.md#inv-52--parity-fixture-同-pr-锁一致)）

后端投影器与前端 `reduceEvent` 是**两套独立实现**（故意的，避免共享 bug），用同一组**业务 fixtures** 锁一致。

```text
新增或修改事件类型 → 前端 + 后端 + fixture 必须同 PR 改
```

只改一边就是**双投影漂移**（[12](./12-open-risks.md) 登记的中风险项）。

`uiProjectionParityCoverage.test.ts` 通过 TypeScript AST 从 Linnkit 的 `RuntimeEventShape` 读取正式事件全集，并要求每个 variant 恰好进入以下治理状态之一：

| 状态 | 要求 |
|---|---|
| fixture-covered | 至少一个 parity 业务场景真实构造该事件 |
| explicitly non-UI | 在非 UI 清单中登记 owner 与不进入 Conversation UI 的理由 |
| unclassified | **测试失败**；禁止静默遗漏 |

当前 `audit_envelope`（dev-only 审计事实）与 `control`（EventStore mutation 命令）明确不进入 Conversation UI。`pending` 是 `requires_user_interaction.interaction_status` 的字段值，不是 RuntimeEvent variant。

门禁必须定位 `RuntimeEventShape`，禁止扫描文件里全部 `z.literal()`；后者会把 payload 枚举误认成事件类型。

### 4.1 事件变更的完整覆盖要求

新增或修改事件时，测试必须覆盖：

- 实时增量
- 历史重载
- 同会话并发 run
- wait-user resume
- 切换会话
- 失败传播

**只测字段或组件快照不构成门禁。**

---

## 5. 测试装配不能有另一套协议（[INV-53](./00-invariants.md#inv-53--测试装配不能拥有另一套协议)）

quickstart、testkit、benchmark 和 scripted node **也必须显式经过 admission sink**。

> 教训 7：测试通过只说明旁路可用，不能证明生产主链正确。

具体要求：

- 测试夹具**不得**原样返回未路由的 draft RuntimeEvent
- 不得通过 `TickOutput.newEvents`、collector 或执行结束遍历 Graph result 维护第二事件通道
- Linnkit `AGENT-GUARD-10-no-testkit-in-production` 强制生产代码不得 import testkit

测试消息构造统一入口：`apps/renderer/domains/conversation/testing/functions/createConversationTestMessage.ts`。

---

## 6. 现有测试资产分布

| 位置 | 内容 |
|---|---|
| `packages/schemas/src/conversation/*.test.ts` | 合同语义（identity / metadata / summary / tool / ui-message） |
| `packages/schemas/src/tools/*.test.ts` | 工具结果合同（agent-todo / tool-output-read） |
| `services/messageProjection/__tests__/`、`messageOwnership.test.ts` | 投影业务 |
| `store/*.test.ts` | selectors、conversationState、contentPhase、中断续答 e2e |
| `store/assistant/projectionStore.*.test.ts` | 投影入口、用户输入 commit、中断历史 |
| `message-window/__tests__/` | 窗口合并与 DTO |
| `features/interactive-run/orchestration/cancelInteractiveRun.test.ts` | 取消 |
| `message-window/orchestration/reconcileTerminalConversationWindow.test.ts` | cancel 与自然完成竞争后的终态收尾 |
| `ui/messageCanvas/**/*.test.ts`、`ui/conversationView/**/*.spec.ts` | 共享 row streaming 语义、builder、virtualizer placement 与滚动手势 |
| `features/subrun-card/__tests__/subrunMessageAdmission.test.ts` | decision/process/output 的完整 child message admission、真实工具 presentation 与失败原子性 |
| `features/subrun-card/__tests__/SubrunProgressVirtualRow.integration.test.ts` | 真实主投影、async registry、`ToolCallsMessage` 统一卡片、Deep Search `SubrunTracePanel` 与精确 detail scope |
| `features/subrun-detail/orchestration/useSubrunDetailNavigation.test.ts` | Host 导航发布唯一 feature scope、关闭先清 scope 再恢复父锚点、切会话销毁 scope |
| `features/subrun-detail/__tests__/SubrunDetailSurface.integration.test.ts` | 真实 parent trace → 正式 child message admission → 共享静态 visual-row → 真实工具卡与终态回答，且正文不重复 Header 标题 |
| `shared/virtualization/vueVirtualizerScrollBridge.spec.ts` | 桥接（库回归） |
| `scripts/e2e/conversation-navigation/` | **真机导航门禁** |

---

## 7. PR 检查清单

改 Conversation 域时逐项确认：

```text
□ 修改前已按 README §3 阅读对应专题文档，并对照 owner schema/实现确认产品语义
□ 对照 00-invariants.md，未违反任何不变量
□ 涉及 schema → schema + Host producer + Renderer mapper/projector + parity + guard 全改
□ 涉及工具卡 → alias + wrapper adapter + strict projector + live/reload admission + 迁移卡片 guard 同步
□ 涉及事件 → 前端 + 后端 + fixture 同 PR
□ 涉及 durable read model → 真实 SQLiteEventStore，四项断言
□ 涉及导航/Host/虚拟列表/Teleport/滚动 → 跑 test:conversation-navigation:electron
□ 涉及 Host Subrun → 真实 virtual row 父进度 + 就地 detail + 返回锚点，且无 Vue warn/error
□ 涉及插件公开 SubrunCard/UiCardGroup → 单独验证 bounded 直接挂载，不经 Transition
□ pnpm run guard:conversation-contract 通过
□ pnpm run guard:conversation-messages-write 通过
□ pnpm run guard:conversation-types-exports 通过
□ pnpm run guard:conversation-agent-control-plane 通过
□ pnpm run test:conversation-semantic-gate 通过
□ 涉及 Agent 上下文压缩 → pnpm run test:context-compaction-gate 通过
□ 域内 vitest 通过
□ 没有新增 catch 后补默认值 / 空对象 / 删字段
□ 没有新增 metadata 控制面，且 agent 选择只走 selected_agent_id
□ 没有在 computed / watch / render 内 parse 或 throw（INV-54）
□ 没有用 workflow 命名 agent 选择（INV-55）
□ 没有在 types/index.ts 新增定义
□ 未修改冻结区（或已有可复现 bug + 单变量 + 真机验证）
□ 未保留调试日志或测试专用生产全局对象
```

> 教训 1：每工单绿灯立即提交，避免堆积未提交改动放大回退成本。

---

## 8. 禁止清单

| # | 禁止 | 正确做法 |
|---|---|---|
| 1 | 用 mock 滚动库 / stub View 的组件测试放行 DOM 改动 | 真机 E2E（§2.1） |
| 2 | 只用 MemoryEventStore 证明 read model | 真实 SQLiteEventStore + 四断言（§3） |
| 3 | 只改一侧投影器 | 前后端 + fixture 同 PR（§4） |
| 4 | 用字段快照代替业务测试 | 覆盖六类场景（§4.1） |
| 5 | 测试夹具返回未路由 draft | 经 admission sink（§5） |
| 6 | 生产代码 import testkit | Linnkit guard 强制（§5） |
| 7 | 删 schema/校验消息让测试通过 | guard 会失败，改设计（§2.2） |
| 8 | 用哨兵 JSON 证明 wrapper 协议 | 真实 producer→adapter→Renderer（§3） |
| 9 | 留调试日志或测试专用全局对象 | 提交前清理（§7） |
| 10 | 用 `workflow` 命名 agent 选择 | 保留给显式工作流产品（[INV-55](./00-invariants.md#inv-55-workflow-product)） |
