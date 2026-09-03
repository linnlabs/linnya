# 18 · Agent 多模态上下文全生命周期提案

> **历史提案 / 上下文压缩章节已替代（2026-08-25）**：本文用于保留多模态 Phase 0–6 的设计与验收证据，不是当前压缩实现入口。正文中 `AISummaryGenerator`、`SummarizationProvider`、Context Checkpoint、图片摘要屏障与 checkpoint coverage 等内容只代表当时设计；当前图片随所属消息或完整工具交互组进入统一自动压缩生命周期，Context Manager 产出候选、校验和重建，Graph 使用当前已锁定模型执行并提交唯一 durable `history_summary`，不存在 checkpoint 工具或专用 Summary Agent。当前合同见 [Context Manager README](../../src/context-manager/README.md) 与 [Context Engineering](../integration/context-engineering.md)。除本提示外，正文保持历史原貌。
>
> **状态**：阶段提案，Phase 0-5 的研究和实施证据保留于本系列临时文档。会话附件的当前稳定合同已经迁入 [`src/features/conversation/attachments/README.md`](../../../../src/features/conversation/attachments/README.md)，后续维护以稳定文档和生产代码为准。本文件不再作为附件存储、回放和 Agent 读取的权威入口。
> **历史背景**：Phase 0-3 已于 2026-07-22 完成，Phase 4 已于 2026-07-23 完成 P4.0-P4.10 并归档。Phase 1-4 的实施与验收证据分别见 [`19-multimodal-phase-1-implementation-runbook.md`](./19-multimodal-phase-1-implementation-runbook.md)、[`20-multimodal-phase-2-implementation-runbook.md`](./20-multimodal-phase-2-implementation-runbook.md)、[`21-multimodal-phase-3-implementation-runbook.md`](./21-multimodal-phase-3-implementation-runbook.md) 与 [`22-multimodal-phase-4-implementation-runbook.md`](./22-multimodal-phase-4-implementation-runbook.md)。v2 基于三项研究修订：本仓库全链路代码审计复核（含错误处理与 fallback 链路）、同类 agent 产品源码调研（AionUi / open-design / openclacky，见 §16）、业界产品公开行为调研（Cline / Codex CLI / OpenClaw / opencode，见 §16.4）。
> **范围**：首期只定义图片输入；合同保留后续音频、视频扩展空间，但不提前实现。
> **一句话结论**：图片不是 UI 附件或某个工具的附加返回值，而是 Agent 上下文中的一等资源；必须同时升级消息合同、资源引用、上下文工程、模型能力、路由与 fallback、工具、provider adapter、历史恢复、UI 和审计。
> **v2 新增关键结论**："对不支持视觉的模型直接发送、让 provider 报错"不能作为主策略，只能作为最后一道 fail-closed 防线；论证见 §3.1。
> **阅读提示**：§4–§12 描述完整目标形态；**§13.0 定义 v1 复杂度取舍**——route profile（§5.1）、requirement 状态机（§5.2）、draft lease（§4.3）、remote count（§6.2）、requirement read model（§7.2）等机制在首期均按 §13.0 降级或推迟，以 §13.0 为首期承诺。

> **2026-08-12 历史决策修订**：本文关于“含图消息不进摘要候选”“checkpoint 不 purge 含图消息”和
> `llm.image_input.context_budget_exceeded` 图片保护终态断言的决策已经废止。当前稳定语义是：附件随所属消息或完整
> 工具交互组服从统一的 tool history、working memory、摘要与 checkpoint 生命周期；活动上下文退出不删除 durable
> event 或 asset。图片 token 估算、trace、能力检查、`ImageInputAdmissionEvidence`、materializer route/token preflight
> 与 provider 映射继续保留。当前数量策略为用户消息入口和四类已支持 route 均最多 100 张，其他字节、像素、token
> 边界不变。本文其余 durable 引用、物化、安全和 provider 结论仍作为历史设计依据。

---

## 1. 为什么这是框架问题

这次需求的直接场景是让 Agent 看见 Slides 渲染后的截图，但问题边界远大于 Slides：

1. 用户需要在输入框选择、粘贴或拖入图片。
2. `resource_read`、未来的截图 CLI 或其他工具也需要把图片交给模型。
3. 图片必须随消息持久化、回放、编辑重发、重新生成，并参与上下文裁剪与摘要。
4. 不是所有聊天模型、provider route 和 API surface 都支持图片输入。
5. 模型切换、policy fallback、额度 fallback、child run、wait-user 恢复都可能在一次运行中改变实际模型。
6. 图片会影响 token 预算、请求大小、安全校验、审计体积和资源回收。

因此，只给 `resource_read` 增加一个图片返回字段，或只在 Renderer 增加上传按钮，都会得到一条无法持久化、无法恢复、无法安全 fallback 的半链路。

### 1.1 目标

- 用户图片和工具图片都通过同一套 provider-neutral 合同进入 Agent 上下文。
- 每次真实 LLM 调用前，都能证明最终模型和 route 满足本轮输入要求。
- 图片归属于具体消息或工具结果，并随该消息一起进入或退出模型上下文。
- RuntimeEvent、数据库和审计只保存稳定资源引用，不保存 base64、data URL 或 provider 临时文件 ID。
- Context Manager 能预算、保留、裁剪、摘要和追踪图片输入，不把图片退化成文件路径文本。
- 不支持图片的模型在 UI 和后端都被明确阻止，不静默丢图、不自动 OCR、不自动换模型。

### 1.2 不做

- 不在 linnkit 内置图片存储、图片解码库或 provider SDK。
- 不靠模型名称、provider 名称或“看起来像视觉模型”推断能力。
- 不复用知识库 OCR 的 `vision` 语义表示聊天模型图片输入。
- 不把 UI `media` 字段改造成模型输入。
- 不把 provider 的 content part、file ID 或公开 URL 写进框架持久化合同。
- 不在首期支持 SVG、动画 GIF、HEIC/HEIF、BMP、音频或视频。
- 不新增 PPT 专用“AI 检查工具”；截图 CLI 是图片生产者，不是另一套上下文通道。

---

## 2. 当前链路审计

### 2.1 权威消息链是纯文本

| 层 | 当前事实 | 影响 |
|---|---|---|
| linnkit 消息合同 | `packages/linnkit/src/contracts/messages.ts` 的 `BaseMessage.content` 是 `string` | `AiMessage` 无法表达图片 |
| RuntimeEvent | `packages/linnkit/src/contracts/events.ts` 的 `user_input.content` 是 `string` | 事件历史无法记录图片归属 |
| LLM port | `packages/linnkit/src/ports/ai-engine.types.ts` 的 `LlmRequestMessage.content` 是字符串 | Context Manager 即使拿到图片，也无法交给 adapter |
| Renderer DTO | `packages/schemas/src/api-dtos.ts` 的输入事件和 `/conversation/next` 请求无附件 | UI 到 host 的入口断开 |
| Renderer 编排 | `chatFlowOrchestrator.ts` 只提交 `prompt: string` | 图片消息、图片-only 消息、编辑重发均无语义 |
| 输入组件 | `AiAssistantInput.vue` 的 `canSend` 只认非空文本 | UI 无法发送图片-only 消息 |

这说明当前框架不是“缺少一个图片工具”，而是消息主干没有多模态资源引用。

### 2.2 adapter 的局部图片类型不能复用为框架合同

`src/infra/adapters/llm/types.ts` 局部出现了 `image_url`（`ChatMessage.content` 已允许 content parts 数组），但它与 linnkit 权威合同没有连接：

- Claude converter 对非字符串的 user content **本地直接 throw**（`claude-converters.ts`），请求根本到不了 Anthropic。
- GPT Responses adapter 的 `sanitizeMessagesForResponsesAPI` 对 user/system content **原样透传**，没有 `input_text` / `input_image` 的显式映射。
- Gemini（OpenAI-compat 路径）与 Ollama 同样原样透传，没有图片输入映射。
- 多处 converter 依赖 `any` / `unknown`，无法在编译期证明 provider 请求合法。

这里有一个重要的不对称事实：**同样一条带非文本 content 的消息，走 Claude 路径是本地异常，走 GPT/Gemini/Ollama 路径是透传给上游**——后者的结局取决于上游网关，可能是 400，也可能是静默丢弃图片部分。这个不对称直接否定了"各 provider 会统一报错"的假设（见 §3.1）。

这是一项现有维护债：adapter 表面上有多模态形状，框架却没有多模态语义。实施时应删除重复的局部权威类型，让 adapter 只消费 linnkit 的出口层合同。

### 2.3 工具 `media` 明确不进入模型

`packages/linnkit/src/runtime-kernel/tools/ui-types.ts` 已明确：

- `observation` 是唯一进入模型的工具结果。
- `data` 与 `media` 服务 UI 和审计。
- `media` 只有路径与显示尺寸，没有资源身份、MIME、hash 和生命周期。

因此，图片工具结果必须新增独立的“模型输入附件”字段，不能改变 `media` 的既有语义。

### 2.4 已有能力可以复用

| 已有能力 | 可复用方式 |
|---|---|
| `ModelConfig.capabilities` / `ModelCatalogEntry.capabilities` | 声明显式 `image_input` 能力 |
| `TokenizerPort.estimateMessage` / `TokenCounterPort.countMessages` | 扩展图片估算与 route 真实计数 |
| `TokenCountResult.imageInputTokens` | 作为 provider preflight 图片计数分项的既有承载字段 |
| tool whitelist 收缩规则 | 在 prepare 阶段按最终模型能力过滤工具 |
| `assets` / SHA256 / `storage_status` | 复用 host 资源事实账本；项目归属只由显式资源库动作建立 |
| host verified-image loader（取代已退役的 `createWorkspaceAssetLocalPathResolver`） | 在调用前按 durable ownership、受管根与内容事实物化图片 |
| `sharp` | 做真实解码、格式和尺寸校验，不靠扩展名猜测 |
| UI projection 的增量与 rebuild 共用函数 | 保证附件刷新后仍能恢复 |
| Event / messages / UI projection 同一 SQLite 事务 | 让消息、附件引用和 UI 历史原子提交 |

### 2.5 需要优先修正的存量隐患

这些问题不是本提案新造的，但会直接破坏图片生命周期：

1. **live/history projection 漂移**：后端历史 projection 把 user metadata 包成 `metadata.metadata`，Renderer 历史 mapper 又整体平铺；live projection 则直接使用 `event.metadata`。当前 `user_quote` 已可能在刷新后进入不同路径，附件不能沿用这条 metadata 通道。
2. **编辑重发逐字段复制**：当前只显式保留 `user_quote`。若继续逐字段补丁，附件和未来其他消息资源一定会漏。应改成传递统一的“用户消息内容聚合”。
3. **regenerate 语义漂移**：重新生成复用了 edit-resend，却仍记录 `truncateReason: 'edit'`。实施附件前应把两个用户动作分开建模。
4. **能力注释陈旧**：`src/core/aiEngine.ts` 仍有注释称 `ModelConfig` 没有 capabilities，与代码事实冲突。
5. **`supportsImageInput` 放错层且无消费者**：它位于 token route 能力中，没有参与选模、fallback 或调用校验。图片输入能力应进入模型/route 合同；token route 只描述计数能力。
6. **审计持久化与日志脱敏不是一层**：HTTP 客户端日志（`llm-http-client.ts`）已识别 `image_url` base64 并截断，但 `llm-run-audit` 仍会把完整 `llmMessages` 落盘。物化后的图片字节会绕过日志脱敏直接进审计存储，两层需要分别定义脱敏合同。
7. **当前轮靠 query 文本反查**：`BaseAgentTask` 用 `request.query` 在 history 中寻找当前 user message；空文本直接返回 null，重复文本还可能绑定到错误轮。图片-only 消息必须改成按 immutable user event ID 定位文本与附件聚合。
8. **`UserMessage.type` 已有 `'image'` 枚举值但无语义**：`messages.ts` 与 `contextPolicy.ts` 的 `AgentSpecMessageType` 都有 `'image'` 值，然而 content 仍是 string、没有附件字段。这是历史占位，不是多模态合同；实施时要么赋予它真实语义，要么删除，不能让它误导后续开发者以为"图片消息类型已存在"。
9. **自定义模型进聊天下拉不做任何能力过滤**：`AiAssistantInput.vue` 对自定义模型不检查 capability 与 `ui_visibility`，全部列出。当前的模型能力门禁比"缺一个 `image_input`"更弱——连既有能力值都没有参与聊天入口过滤。

---

## 3. 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 把 `content` 改成 provider content parts 联合类型 | 改动看似直接 | provider 形状污染 framework；历史绑死 file ID/URL；纯文本消费者全面破坏；资源生命周期无法统一 | 不采用 |
| B. 图片放进 metadata 或 UI `media` | 改动小 | Context Manager 看不见；类型不透明；live/history 已有漂移；工具 `media` 本来就不进模型 | 不采用 |
| C. `content` 保持文本，消息增加稳定附件引用；调用前再物化为 provider parts | 持久化稳定；provider-neutral；纯文本路径兼容；资源和 provider 生命周期解耦 | 需要完整升级消息、上下文和 adapter | **采用** |

方案 C 的关键是明确两层合同，不能把二者混在一起：

1. **持久层引用**回答“这张图是谁、归属于哪条消息、以后还能不能找到”。
2. **出口层物化结果**回答“这次调用通过哪个 route，以什么字节或 provider file ID 发送”。

### 3.1 简化路线评估：不做能力门禁，直接发送让 provider 报错

评审中提出过一条简化路线：不建 `image_input` 能力与预检体系，图片照常发送，不支持视觉的模型由 provider 自己拒绝，我们把报错透传给用户。这条路线的吸引力是省掉能力配置、requirement 派生和两级 gate。经代码审计与业界调研，结论是**不可作为主策略，只能作为最后一道 fail-closed 防线**。依据如下：

**1. "provider 会统一报错"这个前提不成立。** 真实结局有三种，且我们无法控制走哪一种：

| 结局 | 证据 |
|---|---|
| 硬 400，且**污染会话历史** | DeepSeek 等 API 对 `image_url` 返回 deserialization 400；图片消息留在历史中后，**之后每一轮请求都继续 400，会话永久损坏**（Claude Code + DeepSeek 的公开案例：用户只能重开会话） |
| **静默丢图** | 部分 OpenAI-compatible 网关会忽略未知 content part；模型基于纯文本作答，用户以为它看过图——业界公认这比报错更危险 |
| **本地异常，到不了 provider** | 我们自己的 Claude converter 对非字符串 content 直接 throw（§2.2）；报错文案是内部异常而非"模型不支持图片" |

**2. 报错发生的时机太晚。** 我们的 Flow 时序是先持久化 user event、再调用 LLM（§6.5）。provider 报错时消息已入库，正是第 1 种结局里"历史被污染"的成因。没有能力预检，用户没有任何机会在发送前得知不兼容。

**3. 重试与 fallback 会放大失败。** 代码审计确认：vision 类 400 会被 `ErrorClassifier` 归入 `NON_RETRYABLE`（`llm.invalid_request` / `llm.unsupported_capability`），不会无限重试同模型——这一点比预想的好。但 5xx/网络错误会**带着图片原样重试**；cloud quota fallback 会把同一批消息**重放给固定的 `cloud-deepseek-reasoner`**（不支持图片），造成二次失败。Cline 曾有完全相同的公开 bug：粘贴入口漏掉能力检查，图片发给纯文本模型后自动重试 3 次才失败。

**4. 用户看到的报错无法解释原因。** 现有链路（§11.1）里 raw provider 文案默认不直接展示，ErrorBanner 会显示泛化文案（"请求错误"）。用户不知道是"当前模型不支持图片"，更不知道该切换到哪个模型。

**5. 这条路线并不真的省工作量。** 权威合同今天是纯 string，图片根本发不出去；要"直接发送"仍然必须完成消息合同、持久化、物化和 adapter 转换（Phase 1、3 的主体），省掉的只有能力配置与两级 gate（Phase 2 的一部分），却把上面四类事故全部收下。

**采纳的折中：** 保留本提案的能力门禁为主策略；同时在出口层保留 provider 报错作为最后防线——egress gate 之后 provider 仍然拒绝时（能力声明错误、网关行为变化），错误按 §11 合同分类为不可重试并明确定位到附件，不触发带图重试与降级 fallback。业界同类（openclacky 的出站 strip、opencode 的 `unsupportedParts` 拦截）都是"预检为主、出口兜底"的双层结构，没有一家把"让 provider 报错"作为唯一机制。

---

## 4. 推荐架构与边界

### 4.1 持久层：文本 + 稳定资源引用

`content` 继续表示人类可读文本；消息增加可选附件数组。Linnya durable 合同 `ConversationAttachmentRef` 至少包含：

| 字段 | 语义 |
|---|---|
| `id` | 消息内稳定附件 ID |
| `kind` | 首期固定为 `image` |
| `assetId` | host 资源账本的稳定 ID |
| `mediaType` | 经真实解码确认的 MIME |
| `byteLength` | 已登记字节数 |
| `width` / `height` | 解码后的像素尺寸 |
| `sha256` | 内容完整性与去重依据 |
| `fileName` / `label` | 可选展示信息，不参与资源寻址 |

linnkit 不直接认识 workspace `assetId`。它的 `RuntimeResourceRef` 使用 framework-neutral 的 `resourceId`，并保留 kind、MIME、字节、尺寸、hash、顺序和显示信息；Flow host 是 `assetId ↔ resourceId` 的唯一映射边界。Linnya 首期可让两者取相同值以降低迁移成本，但类型和 owner 必须分开，不能让 linnkit import workspace 资源定义。

首期只允许 `user_input` 和 `tool_output` 携带模型附件，不开放 system/assistant 任意图片 parts。消息内保持一个文本块和一个有序附件数组：provider 转换时文本在前、图片按数组顺序在后；图片-only 消息允许文本为空。首期不承诺文字与图片任意穿插，避免为了尚无真实需求的富文本语义提前把持久层改成通用 parts AST。

引用在主链路中的传播必须显式，不藏进 metadata：

| 合同 | 图片字段 | 生命周期 |
|---|---|---|
| Renderer ↔ host message DTO | durable attachment ref | 请求、projection、历史窗口 |
| `RuntimeEvent.user_input` / `tool_output` | provider-neutral attachment ref | 事件持久化与运行回放 |
| `AiMessage` | provider-neutral attachment ref | Context Manager 选择、摘要与 trace |
| `LlmRequestMessage` | provider-neutral attachment ref | formatter 到 host AI engine 边界 |
| host resolved request | bytes 或 provider upload cache reference | 仅单次 adapter 调用 |

`MessageFormatter` 负责原样保留引用与顺序，不负责读取文件。host AI engine 通过注入的窄 attachment resolver port，在 adapter converter 之前把引用解析成短生命周期 resolved request；resolved 类型可以放在 linnkit port 层供 materializer、token counter 与 adapter 协作，但不能进入 RuntimeEvent、AiMessage 或公开 durable schema。

`AgentInvokeRequest` 还必须增加 `currentUserEventId` 或等价的当前消息聚合引用。event converter 保留 immutable event origin，`BaseAgentTask` 按 ID 选择当前消息；`query` 只作为消息文本，不能再承担身份定位。这样空文本 + 图片和重复文本都能稳定绑定到正确轮次。

持久层禁止保存：

- base64 或 data URL；
- 绝对路径作为资源身份；
- provider file ID；
- 公开远程 URL 作为长期权威资源；
- 未验证的 Renderer 自报 MIME、尺寸或 hash。

Renderer 与 host 的 durable Zod 合同建议归入 `packages/schemas/src/conversation/`；linnkit 的 provider-neutral 引用归入 `packages/linnkit/src/contracts/`。Flow host 只做两个公共合同之间的边界映射，不让 linnkit 直接依赖 Linnya 的 workspace schema。

### 4.2 出口层：调用前临时物化

只有 Context Manager 已完成选择、最终 route 已确定且能力校验通过后，host 才执行：

1. 通过注入的 resolver 把 `resourceId` 解析为 host 受管 asset 与本地文件。
2. 校验账本状态、实际文件、hash、字节、MIME 和尺寸。
3. 按当前 provider route 的限制选择 inline bytes、data URL 或 provider file cache。
4. 生成 provider-neutral 的短生命周期 resolved attachment。
5. 由 adapter 显式转换成该 provider 的 content parts。
6. 审计只记录资源 ID、校验结果和映射方式，不记录原始字节。

provider file ID 只能作为 adapter cache。它可能过期、被删除或只在某个 API surface 可用，不能成为消息历史的事实来源。

### 4.3 资源归属与回收

现有 `assets` 继续作为资源事实账本，新增 conversation/event 到 asset 的引用账本，而不是再造一套图片表。引用必须绑定 immutable event，至少表达：

- `conversationId`
- `eventId`
- `attachmentId` 与顺序
- `assetId`
- `source`：用户输入或工具结果
- 创建时间

会话附件归属只由 `conversation_event_asset_links` 表达。项目会话不会因此自动创建 `project_asset_links`；只有用户显式执行资源库动作时，附件才获得项目资源身份。删除会话、截断事件、编辑重发和资源 GC 都基于全部引用账本判断，不删除仍被 conversation、project、document 或媒体 block 引用的 bytes。

P1.6 已把 event 引用事实落为 v46 `conversation_event_asset_links`，event/attachment 与 event/ordinal 分别唯一，asset 外键继续 `RESTRICT`。后续实现已移除 EventStore 自动写项目归属的逻辑，并由 v48 清理历史 `role='conversation_attachment'` 自动链接。`appendEventToRun()` 在既有短事务里完成必要的 asset 登记、event link、event、materialized message、UI projection 与 stats；任何附件事实不一致都会整笔回滚。

P1.8 已把 UI read model 升到 v47：`conversation_ui_messages.attachments_json` 是独立、显式、经过 durable schema 校验的附件投影列。附件不进入 `payload_json`，window 读取也不临时回查 event；v47 只把既有 `ready` projection 标成 `pending`，由启动维护从 durable events 重建。Runtime 内仍使用 `resourceId`，只有进入 Linnya conversation/UI 边界时才映射为 `assetId`。live、window、force rebuild 以及 user/tool projection 现在共享同一附件语义和 parity fixture。

**字节存哪里**：不存 SQLite blob（GB 级膨胀，拖垮 WAL/备份/查询），也不引用用户原文件路径（用户删除/移动原图即历史死链，AionUi 与 open-design 的实测坑，见 §16）。采用三层结构：

1. **字节**：当前实现固定在应用级 AppData sidecar：草稿位于 `ConversationAttachments/v1/staging/`，最终文件位于 `ConversationAttachments/v1/content/{sha256 前两位}/{sha256}.{ext}`；账本 URI 使用不含绝对路径的 `/Resources/Attachments/{sha256 前两位}/{sha256}.{ext}`，同图重发与编辑重发天然复用同一份字节；旧 Workspace `ManagedAssets` 只保留为迁移期读取边界；
2. **账本**：SQLite `assets` 表只存元数据（`local_path`、hash、字节数、MIME、`storage_status`）；
3. **消息**：event / projection 里只存 attachment 引用（assetId）。

**用户删除原始文件的语义**：发送那一刻即完成复制，用户磁盘上的原图从此与会话无关——删除、移动、改名都不影响后续轮次；只要图片消息仍在 active context，物化阶段从受管副本读字节，agent 继续"看得到"。受管副本的删除只由引用账本 GC 决定，用户不直接管理该目录。

生成图仍按资源生产者自己的生命周期登记；conversation 导入附件必须走 AppData 副本语义，不能沿用生成图的原地登记，也不能自动进入项目资源库。新图片保存真实解码校验后的原始上传字节，不做静默压缩或分辨率缩放。

尚未发送的附件只存在于 host 进程内 draft registry 和 staging，不进入 `assets` 账本，也不跨重启恢复，因此不需要 draft lease 表或状态机。用户移除附件时显式释放；进程异常退出留下的 staging 由下一次 ingress 初始化清理。发送时先发布内容文件，再在 SQLite 短事务中登记 asset、event 与 link；只有事务成功后才释放 draft。

GC 由启动维护执行。它先复核 conversation、project、document、image block 和 audio block 等全部引用面，再删除完全失去引用的 asset 与受管文件；文件发布成功但 DB 提交失败留下的未登记副本也在安全时间边界后回收。越出新 AppData attachment root 或旧迁移 root 的真实路径绝不由该维护流程删除。

conversation domain 拥有导入、存储路径和生命周期；跨 domain 的读取只通过窄 verified-content port 协作。workspace asset domain 当前仍承载通用 verified-image loader 和账本 adapter，这是已经记录的命名与所有权债，不改变新写入的归属边界。

### 4.4 端到端数据流

| 阶段 | 输入 | 产出 | 权威校验者 |
|---|---|---|---|
| 1. 导入 | 用户文件或工具临时文件 | AppData staging draft + 已验证元数据 | conversation attachment ingress |
| 2. 提交 | current user event ID + 文本 + asset 引用 | user/tool RuntimeEvent | Flow host |
| 3. 持久化 | RuntimeEvent | event、UI projection、asset link | SQLite 同一事务 |
| 4. 回放 | durable events | 带附件的 `AiMessage` | event converter / runtime replay |
| 5. 候选选模 | 保守 requirement + model/route catalog | 用于预算的 candidate route | ModelResolver |
| 6. 上下文选择 | 消息、candidate route、预算、摘要/checkpoint | final context + final requirement | Context Manager |
| 7. 锁定/回退 | final requirement + candidate route | 已锁定 active route | ModelResolver / fallback policy |
| 8. 物化 | final context 的 resource 引用 | 短生命周期 resolved attachments | host attachment resolver |
| 9. 出口准入 | resolved input + route profile | route 校验与可选 remote count | host token/egress adapter |
| 10. 转换 | provider-neutral 请求 | provider content parts | typed provider adapter |
| 11. 调用与记账 | provider 请求/响应 | usage、trace、audit refs | adapter + telemetry |

字节只在第 8–11 阶段存在；第 1–7 阶段都使用稳定引用。这既避免 base64 污染历史，也避免为最终被 Context Manager 删除的图片做无用读取和编码。若第 7 阶段换成 context window、图片计数规则或 API surface 不同的 route，必须用新 route 重新执行第 6 阶段，不能复用旧 route 构建的 context。

---

## 5. 模型能力与输入要求

### 5.1 新增明确能力 `image_input`

`image_input` 表示“模型本身能理解图片输入”。它与现有概念严格区分：

| 名称 | 语义 |
|---|---|
| `image_input` | Agent 对话请求可向模型发送图片 |
| `vision` | 当前主要服务知识库 OCR/视觉解析和 UI 分类 |
| `image_generation` | 模型生成图片，不代表能在聊天上下文读取任意图片 |
| remote token count | route 能否远程计数，不代表模型能看图 |

模型能力来源必须是显式配置，禁止按模型名猜测。自定义模型默认不支持图片；设置页只有在用户明确开启后，才写入 `image_input`。但这个模型级标签只是语义能力上限，不能单独证明当前 API surface 能在所有消息位置发送图片。

每条 route 还必须声明 egress profile：

| 维度 | 首期值 | 作用 |
|---|---|---|
| placement | `user_content` / `tool_result` | 区分用户图片与工具结果图片 |
| transport | `inline_data` / `remote_url` / `provider_file` | 每个 placement 分别声明可用传输 |
| processing policy | OpenAI detail、Gemini media resolution 等 route 参数 | 让估算、remote count 与真实调用使用同一策略 |

有效图片能力要求同时满足：模型有 `image_input`、route 支持当前 placement、至少一种 transport 能承载该资源、adapter 已实现该映射。不能用“支持 user 图片”推导“支持 tool result 图片”，也不能用“OpenAI-compatible”推导完整 egress profile。

### 5.2 本轮 `ModelInputRequirement`

运行时需要一个独立的输入要求对象。首期记录 `image_input` 以及实际出现的 placement；未来可以扩展音频、视频等能力。它由后端根据最终上下文和工具结果派生，Renderer 不能传一个可被伪造或弱化的布尔值。

- 用户附件产生 `image_input + user_content` 要求。
- 工具结果附件产生 `image_input + tool_result` 要求。
- 静态图片工具在暴露 schema 前就要求 route 支持 `tool_result`；`resource_read` 这类动态混合工具在资源解析为图片时再做同一校验。
- transport 由物化阶段根据 route profile、资源状态和 provider 限额选择，不由消息历史固化。

要求遵循两个规则：

1. **同一 run 内只增强、不减弱**：工具在中途产生图片后，后续调用都保持 `image_input` 要求。
2. **跨 run 按最终 active context 重新派生**：若图片消息已被真实多模态摘要或 checkpoint 替换并退出上下文，下一轮可以解除要求。

### 5.3 模型选择、锁定与 fallback

先记录代码审计确认的现状，避免夸大或低估威胁：`ModelResolver.resolveModelId()` 只做 `requested || defaultChat`，完全不看能力；`pickFallbackChatModel` 只要求 `chat` capability + api_key。现有 policy fallback 只匹配 OpenRouter 地域限制与 Gemini thought_signature 等特定错误，**vision 类错误一般不会触发自动换模型**；真正的风险点是 cloud quota fallback 固定降到 `cloud-deepseek-reasoner` 并重放同一批消息，以及 `RETRYABLE`（5xx/网络）错误会带图重试。另外 `allow_model_fallback === false` 已可禁止切模。因此下面的合同不是防御假想敌，而是把这几条真实链路纳入统一校验。

每次真实调用前都必须校验“实际 active model + route”，不能只校验用户最初选择的 ID：

- 显式模型 ID：校验存在、enabled、chat 和输入能力。
- policy fallback：候选必须满足当前 `ModelInputRequirement`。
- cloud quota fallback：同样必须保持要求，不能固定降到不支持图片的模型。
- 找不到兼容 fallback：明确失败，不能删图、OCR 降级或自动换成另一个未经用户允许的语义路径。
- wait-user 恢复：从 active context 重新派生要求，并与快照记录核对，防止旧快照弱化能力。
- child run：默认不继承父 run 的图片要求；只有显式传递图片附件时才要求 `image_input`。

当前 `ModelResolver.resolveModelId()` 和两条 fallback 链都需要纳入这一合同。`ToolContext.modelId` 也不能继续被视为实际模型真源，应由运行时传入已经解析并锁定的 active route。

模型 catalog 中的 `image_input` 是模型声明的能力上限，route egress profile 则声明当前 API surface 已实现的 placement、transport 与 processing policy；运行时同时校验二者。这样同一模型经官方 Responses、Chat Completions 或第三方 OpenAI-compatible gateway 时，可以得到不同且可验证的结果。

### 5.4 调用阶段顺序

当前 `prepareCallStage` 先选模型和工具，再构建 context。图片要求来自最终 context，这个顺序无法成为长期正确结构。建议分两步演进：

**第一步，低风险接入现有流水线**：在 `prepareCallStage` 早期，从 active 且未被 replacement/checkpoint 排除的消息派生保守要求；用它选模和过滤工具。context build 完成后再派生一次最终要求并校验，随后才物化附件和调用 provider。两次派生共用一个纯函数，不写两套规则。

**第二步，收敛为清晰阶段**：把流程明确拆成“读取 active history 并派生保守要求 → 解析 candidate route → 构建 context 并产出 final requirement → 校验并锁定 route → 过滤工具 → 物化附件 → provider call”。context-internal summary 使用自己的 route 和 requirement；主调用不能借 summary route 的能力通过校验。最终 route 若相对 candidate route 发生影响预算或图片计数的变化，就重新 build context。

每次 provider fallback 重试都复用同一个 final requirement 并重新执行 route egress validator。同一 run 的工具结果新增图片时，下一次 loop 的 requirement 增强；不能沿用上一轮已经准备好的纯文本请求。

---

## 6. Context Engineering 生命周期

### 6.1 消息原子性

附件归属于消息，而不是漂浮在 conversation 上：

- 保留消息时，其附件引用一起保留。
- 删除或替换消息时，其附件一起退出 active model context。
- Context Manager 不能只保留图片而丢掉对应文本，也不能只保留文本却默默丢图。
- 工具调用组被删除时，该组工具结果产生的图片也一起退出上下文。
- 字符截断只作用于文本，不得作用于附件引用或图片字节。

### 6.2 P1 / P2 / P3 与预算

现有上下文组件优先级继续复用，但每个组件的 token 估算必须包含附件：

- 初次 context build 只用本地 route-aware estimate；`TokenizerPort` 按尺寸与 candidate route 的 processing policy 给出带来源标记的估算，不读取图片 bytes。
- final context 物化后，支持 remote count 的 route 在出口准入阶段调用 provider 计数；`TokenCountResult.imageInputTokens` 继续承载 provider preflight 图片分项。
- remote count 超出 route/context 限额时，把实际计数回传 Context Manager，最多重建一次；重建后仍超限则明确失败，禁止无界循环。这个 admission 回路是多模态新增机制，不声称 13 号计划已经实现。
- response usage 若 provider 明确给出图片分项，写入本提案新增的可选 canonical 分项；不给分项时保持 unknown，不用总差值硬猜。
- `ContextTrace.tokenComponents` 记录每个附件的 ID、所属消息、估算 token、来源、keep/drop 和原因。

图片不能因为“字符数为 0”而被当作零成本消息，也不能通过 `avgCharsPerToken` 估算。同一 candidate route 的 processing policy 必须同时用于本地估算、remote count 和真实 egress；若 adapter 最终改变 OpenAI detail、Gemini media resolution 或其他影响 token 的参数，应视为 route 变化并重新做预算。

provider 只返回 aggregate remote count 时，重建只把总差值作为本轮 admission budget 反馈，并继续按现有组件优先级裁剪；不能把差值平均分摊成伪造的单图 actual。该反馈算法和 ContextTrace 表达随 remote count + admission rebuild 的后续独立批次锁定；Phase 3 v1 只做 route-aware 本地估算，含图时不调用当前 pre-materialization remote counter。

Context Manager 在一次 LLM 编排前只构建一次 final context，而 policy/quota fallback 可能切换到不同图片 processing profile。Phase 3 必须把输入预算、非图片成本和初始图片估算作为短生命周期 admission evidence 传给调用链；每个 active attempt 用新 profile 重算图片分项。仍在原输入预算内才允许继续物化，超出则 fail closed；retry loop 不重跑摘要/裁剪，也不沿用旧 route 的图片估算。

### 6.3 摘要

当前 `AISummaryGenerator` 只拼接 `role: content`，会完全忽略图片。图片进入系统后必须遵守：

1. 摘要候选包含图片时，summary 调用本身要求 `image_input`，并收到候选消息的真实附件。
2. summary route 不支持图片时，不得执行纯文本摘要并替换原消息；先跳过含图片的候选范围，若剩余上下文仍无法满足预算，再返回明确的 summary capability 错误并阻止主调用。
3. 成功的多模态摘要生成文本 summary，并继续用 `replacementSourceIds/replacedMessageIds` 指向被替换消息；不需要复制附件替换 ID。
4. 原附件退出 active model context 后仍保留在 durable history，供 UI 查看和审计，直到引用 GC。

这样才能保证“摘要后解除 `image_input` 要求”是有语义依据的，而不是因为实现漏掉图片。

### 6.4 context checkpoint

主动 context checkpoint 是一次显式语义压缩，但“模型曾看过图片”不足以证明 checkpoint summary 覆盖了哪些资源。checkpoint marker 必须增加由 runtime 生成的 coverage，记录被 summary 覆盖的 immutable message/event IDs 和 resource IDs；模型只提供 summary 文本，不能自报覆盖范围。

`CheckpointSummarizationProvider` 只能 purge coverage 明确包含的图片消息，并据此解除 requirement。旧 checkpoint 或 coverage 不完整时，相关图片继续留在 active context；若因此超预算，返回明确错误，不静默跳过。durable history 和资源引用始终保留到正常 GC。

必须继续区分 context checkpoint 与 EngineState checkpointer：前者改变下一轮模型上下文，后者只是运行状态快照，不能据此解除图片要求。

### 6.5 历史窗口不是能力真源

Renderer 只加载窗口化历史，不能通过扫描当前 UI 消息判断 conversation 是否需要图片能力。权威要求必须由后端在 Context Manager 完成 active message 选择后派生。

校验分两级，不能假装 run 前已经知道 final context：

1. **run 前 ingress gate**：校验草稿资源、当前选择模型的声明能力、已知 user-content route 能力和运行/配额资格；失败时不写 user event，保留草稿。
2. **run 内 egress gate**：event 已持久化、Context Manager 已构建 final context 后，校验最终 requirement、fallback route、资源完整性和 provider 限额；失败时把 run 标为 failed 并保留用户消息，供切模或重试。

若产品将来硬性要求 egress 失败也不能留下 user message，就必须新增带 projection revision 的 prepare/commit 协议，并在 commit 时重验；不能把现有 Flow 时序描述成一个普通 preflight 就当作已解决。

---

## 7. 用户输入与历史交互

### 7.1 草稿生命周期

输入区新增 conversation 内建的 `message-attachments` feature，负责选择、粘贴、拖拽、预览、移除和校验状态。它不应伪装成现有 `ConversationInputAccessory`，因为附件改变了消息提交语义；但布局上与引用条同区（输入框上方，`ConversationInputAccessoryHost` 所在区域）。

**输入区交互规范**：

- **附件行**：缩略图横排在输入框上方（64px 方形圆角，超出横向滚动）；hover 显示移除按钮；点击打开应用内大图预览；附件按钮、粘贴、拖拽均可继续追加；达到张数上限后禁用添加入口并说明。业界（ChatGPT/Cursor/Cline）均为此模式。
- **即时显示、异步校验**：Electron 本地场景没有网络上传等待——"上传"只是复制进受管临时目录 + 真实解码校验，毫秒级。粘贴/拖入立即用内存预览渲染缩略图，后台异步完成复制与校验；发送时若仍有附件在校验中，等待队列完成再提交（百毫秒级，无感）。不做进度条（AionUi 的 `isUploading` 等待是它 HTTP multipart 架构的产物，不适用于本地复制）。
- **超限提示原则：错误在添加时刻暴露，不留到发送时刻**（发送时只剩模型能力检查）：
  - 格式不支持 / 单图超限 / 超张数：该文件不进附件行，在输入区显示内联短暂提示（不用全局 toast），文案具体到文件与数值（"`xxx.png` 超过 10MB 上限（实际 14.2MB）"）。
  - 多文件混合拖入：合法项正常添加，非法项汇总一条提示（"已添加 3 张，1 张超出大小限制被跳过"）。
  - 异步解码失败（损坏、伪装扩展名）：缩略图转错误态角标，悬停显示原因，可移除。
  - 消息总量超限：添加增量时即时校验并拒绝该张。
- **发送条件**：`canSend` = 文本非空 **或** 有效附件非空（图片-only 合法）；存在错误态附件时禁止发送并指向该附件。

发送与运行顺序必须是：

1. Renderer 先用 catalog 做快速能力检查；当前选择模型不支持时，不开始导入。
2. 所有附件进入受管临时目录（§13.0：不进 assets 账本），数量、总大小、真实格式和解码尺寸通过 host ingress policy。
3. run 前 ingress gate 校验当前模型声明、adapter 能力、资源和运行资格。
4. 按现有 Flow 语义注册 run，并在持久化事务中登记 asset、创建 user event、event asset links 和 UI projection；current user event ID 随请求进入 Agent。
5. 随后由 Context Manager 构建 final context，并执行权威 egress gate。
6. egress gate 失败时保留 user message 和 failed run，用户可切换兼容模型后重试；只有第 1–3 步失败时才保留未发送草稿。

图片-only 消息是合法消息，依靠 current user event ID 定位，不能再受 `query.trim()` 影响。

### 7.2 模型切换

- 草稿含图片时，模型下拉仍可展示全部 chat 模型，但不兼容项应禁用并说明原因（纯 catalog 查询，v1 实现）。
- 自定义模型的图片开关只是能力声明入口，不替代一次真实 adapter 校验。
- "已存在 active 图片历史时阻止切换到不兼容模型"按 §13.0 推迟：v1 允许切换，下一轮 egress gate 以稳定错误码明确报错并引导切回；长期方案才引入带 projection/context revision 的 active requirement read model。

### 7.3 编辑重发与重新生成

- 编辑重发复用原 asset ID，不复制 bytes；新增或删除附件产生新的 user event 和引用关系。
- truncate 必须在同一事务处理 events、UI projection、旧消息和附件引用。
- 重新生成沿用前一条 user message 的文本与附件，但记录独立的 regenerate 语义，不再借用 edit 原因。
- 刷新后的历史、live projection 和 window projection 必须得到同一附件结构。

### 7.4 历史资源异常

若 active context 中的资源缺失、损坏或 hash 不一致，应阻止运行并指出消息与附件。不能默默忽略图片继续请求。“忽略缺失附件继续”若未来需要，必须是用户显式动作并生成新的消息语义，不作为自动 fallback。

---

## 8. 工具与图片输入

### 8.1 工具合同

`BaseTool` / `ToolRuntimeDefinition` 增加可选输入能力要求；成功结果增加独立的模型输入附件字段。该字段与既有字段边界如下：

| 字段 | 消费者 | 是否进入模型 |
|---|---|---|
| `observation` | 模型、UI、审计 | 是，文本 |
| `data` | UI、审计 | 否 |
| `media` | UI、审计 | 否 |
| `modelInput.attachments` | Context Manager、provider adapter | 是，资源引用 |

会产出模型图片附件的静态工具要求 `image_input + tool_result` placement。工具 schema 在 prepare 阶段按最终模型与 route egress profile 过滤；ToolNode 执行期再次校验，以覆盖 host-forced tool 或其他绕过 schema 的真实路径。这不是重复业务判断：前者控制模型可见能力，后者保护执行边界。

### 8.2 `resource_read` 是动态混合工具

不能因为 `resource_read` 有可能读到图片，就对不支持图片的模型整体禁用它：

- 文本资源继续可读。
- URI 实际解析为图片时，工具根据 active route 校验 `image_input + tool_result` placement。
- 支持时返回文本 observation 加模型附件引用。
- 不支持时返回明确 capability error，不把本地路径当文本交给模型。

当前 `asset_image` 已能解析元数据和本地路径，可复用其 asset resolver；缺的是统一工具结果附件合同。

### 8.3 哪些现有工具不需要标记

- `text_to_image` 目前生成图片，但模型只收到文本 observation，UI 通过 `media` 展示，因此不自动要求 `image_input`。
- 当前 `ppt_inspect` 返回结构化文本诊断，也不要求 `image_input`。
- 未来“渲染幻灯片并让模型直接看截图”的命令或工具才要求 `image_input`。

工具是否需要图片能力取决于“结果是否进入模型上下文”，不是取决于它是否处理或生成图片文件。

---

## 9. Provider adapter

框架出口层保持 provider-neutral；每个 adapter 对自己的 API surface 显式、穷尽地转换，不共享一个宽泛的 `any` content type。

| Provider/API | 当前官方输入形态 | adapter 责任 |
|---|---|---|
| OpenAI Responses | user input 使用 `input_text` + `input_image`；function call output 有独立 content 结构 | 分别验证 `user_content` 与 `tool_result` placement，不能原样透传 Chat Completions 结构 |
| OpenAI Chat Completions | user content 支持 `text` + `image_url`，tool message 不等价支持图片 | route 只声明已验证的 `user_content`；图片工具不在该 route 暴露 |
| Anthropic Messages | image source block；支持 base64、URL、Files API | 保持 tool result 的 block 顺序；provider file ID 只做缓存 |
| Gemini generateContent | text part + `inlineData` / `fileData` | 区分 generateContent 与其他 API surface 的限制 |
| Gemini function response | 工具结果图片进入 function response parts；Developer API 支持 inline data、不支持 file data | `tool_result` profile 只声明 `inline_data`，不能套用 user transport |
| Ollama / OpenAI-compatible gateway | 只有实际 adapter 和 route 完成验证后才声明 | 默认不支持，不靠“兼容 OpenAI”推断图片协议 |

同一 provider 的不同 API surface 也可能有不同格式、大小、URL、Files API 和工具结果规则，因此能力最终属于 route，而不只是 model ID。

---

## 10. 格式、大小与安全

### 10.1 两层校验

不要把所有 provider 限制取交集后写死进 linnkit：

1. **Host ingress policy**：控制 Linnya 接受什么资源，负责 magic bytes、真实解码、MIME、字节、像素、数量和总量。
2. **Provider/route egress validator**：在调用前校验当前 API surface 的真实限制，并选择物化方式。

linnkit 只定义校验结果和错误合同，不内置具体数字。

### 10.2 首期产品策略建议

为降低攻击面和跨 provider 差异，首期只接受静态 JPEG、PNG、WebP。建议默认：

- 单图不超过 10 MB；
- 单条消息不超过 10 张；
- 单条消息图片总量不超过 20 MB；
- 像素上限作为 host 可配置策略，解码后校验，防止压缩炸弹；
- SVG、动画 GIF、BMP、HEIC/HEIF 首期明确拒绝，不做隐式转换。

这些是 Linnya 首期 policy，不是 framework 协议。未来增加格式时，应生成受管的 normalized derivative，并保留原 asset 与派生 asset 的关系，不能悄悄覆盖原资源身份。

### 10.3 安全与隐私

- 只信 magic bytes 与真实解码结果，不信扩展名和前端 MIME。
- 资源解析必须限制在 app-managed storage，禁止任意绝对路径穿透。
- base64、raw bytes、data URL 不进入 RuntimeEvent、SQLite JSON、telemetry、audit 或普通日志。
- 审计记录 asset ID、MIME、大小、hash、解析状态、route 和映射方式。
- provider 上传缓存要有过期与删除策略；缓存失效后从本地受管 asset 重建。
- 请求失败日志不能序列化完整 provider request body。

---

## 11. 错误合同与用户行为

### 11.1 现有错误链路事实

新错误合同不是从零建，现有链路已经具备骨架：adapter 抛出 `LlmProviderError` → `callWithRetryFallback` 交给 `ErrorClassifier.classify`（`packages/linnkit/src/shared/errorClassifier.ts`）→ 终态 `emitFinalError` 产生 agent `error` 事件 → SSE → Renderer `projectErrorEvent` + `normalizeConversationError` → ErrorBanner。已有的分类里，`NON_RETRYABLE` + `llm.unsupported_capability`（匹配 "not supported" 类文案）和 `llm.invalid_request`（HTTP 400）恰好覆盖典型 vision 拒绝，不会重试同模型；用户消息也不会丢（user event 先持久化）。

但有两个缺口必须补：其一，ErrorBanner 对这类错误只显示泛化文案，用户不知道"当前模型不支持图片"、也不知道兼容模型有哪些；其二，分类靠 provider 字符串匹配，不同网关文案会漏判成可重试。因此下表的错误类别必须成为 domain 层稳定 code，由能力校验主动产生，而不是等 provider 文案倒推。

### 11.2 错误类别

| 错误类别 | 典型原因 | 产品行为 |
|---|---|---|
| draft invalid | 格式、大小、数量、解码失败 | 不发送，保留草稿，指出具体附件 |
| model capability missing | 当前模型或 fallback 不支持 `image_input` | 阻止选择或运行，列出兼容模型 |
| route unsupported | 当前 gateway/API surface 不支持所需 placement/transport | 阻止运行，提示检查 route 配置 |
| attachment unavailable | 文件缺失、storage 状态异常 | 阻止运行，定位消息和 asset |
| attachment integrity failed | hash、字节或解码结果不一致 | 阻止运行，要求重新导入 |
| provider limit exceeded | 当前 route 的动态限制更严格 | 阻止调用，指出限制；不自动压图 |
| summary capability missing | 摘要候选有图片、summary route 不支持且跳过后仍超预算 | 不做错误摘要；阻止主调用并说明所需能力 |
| adapter mapping unsupported | converter 未实现对应来源或 tool result 形态 | fail closed，并记录 adapter/route |

错误必须在 domain 层有稳定 code；Renderer 只负责把它转换成可读文案，不解析 provider 字符串猜原因。

---

## 12. 可观察性与 token

### 12.1 ContextTrace

每次 context build 至少记录：

- attachment count；
- attachment ID / resource ID（host 审计可附 asset ID）；
- 所属消息或工具组；
- placement、最终 transport 与 processing policy；
- keep/drop/replaced 决策及原因；
- 估算的图片 input token、source、confidence 和 route；
- 资源解析状态；
- 最终 `ModelInputRequirement`；
- 最终模型与 route 的能力校验结果。

ContextTrace 只记录引用和数值，不记录图片内容。

### 12.2 Token ledger

本提案接续 `13-token-management-ledger-plan.md`，不另造 token 系统：

- 扩展 `TokenizerPort.estimateMessage` 消费附件引用或已解析元数据。
- remote count 继续 route-aware，但在 resolved input 产生后的 egress admission 阶段执行；`TokenCounterPort` 需要以短生命周期 resolved attachments 扩展输入，不能要求 durable message 保存 bytes。
- 当前只有 `TokenCountResult.imageInputTokens`；实施时为 `CanonicalLlmUsage` 新增可选图片输入分项，且它是 `inputTokens` 的组成信息，不额外相加。该字段只承载 provider response 明确给出的值。
- provider 不给图片分项时，不用 input 总量减文本估算来伪造 actual。
- summary 的图片 token 继续通过已有 `phase:'context-internal'` usage sidecar 进入同一 run 账本。

---

## 13. 建议实施顺序

### 13.0 复杂度分级：本文机制的 v1 取舍

前文 §4–§12 描述的是完整目标形态。逐项复核后结论是：**复杂度的大头不在"前置校验"本身**——校验本质上只是"发送前查一次 catalog、调用前对最终消息列表跑一个纯函数"这两个动作；真正贵的是围绕它们的"机制"（requirement 状态机、route profile 矩阵、remote count 回路、draft lease）。因此 v1 保留语义、砍掉机制，分三级：

**A. 必须做（省了会直接出事故，无简化空间）**

- 消息合同 + 稳定附件引用（§4.1）；base64 不进历史/审计（§10.3）——业界共识，反例（openclacky session 膨胀、DeepSeek 历史污染）都是真实事故。
- current user event ID（§4.1）——图片-only 消息的前提，同时修复既有的重复文本反查 bug。
- `image_input` 能力值 + 全部三个配置入口（内置 catalog / 自定义模型 / Linnya Cloud，见 Phase 2）。
- 发送前 ingress 检查 + 调用前 egress 校验（§6.5）。
- host ingress 真实解码校验（§10.1）；附件随消息原子进出上下文（§6.1）；图片 token 估算非零。
- Phase 0 存量漂移修复。

**B. 可简化（保留语义，把"机制"降为"函数或约定"）**

| 机制 | 完整设计（章节） | v1 简化 |
|---|---|---|
| route egress profile（placement × transport × processing policy） | §5.1 | 能力面仍降为 **adapter 级静态声明两个布尔**：支持 user 图片吗、支持 tool-result 图片吗；另由 host 维护窄 `ImageInputProcessingProfile`，只承载本地估算、route limit 和 converter 必须同源的处理事实。它不是可扩展矩阵，也不替代 model capability/adapter placement；provider file cache 或更复杂 transport 出现后再升级 |
| `ModelInputRequirement` 状态机（只增不减、wait-user 快照核对、child run 继承规则，§5.2/§5.3） | §5.2 | 降为**一个纯函数**：每次真实调用前对 final context 派生"是否需要 image_input + 哪些 placement"并校验 active 模型。因为每次都从当前上下文重算，"同 run 只增强""跨 run 重派生""wait-user 恢复重验"这些不变量自动成立，不需要独立对象、持久化或核对逻辑 |
| draft lease + 过期 + 提交转移（§4.3） | §4.3 | 草稿**不进 assets 账本**：导入=复制到受管临时目录+校验，注册表只存在于 host 进程内；ingress 实例初始化时清空上次进程的 staging，发送事务时才登记 asset + event link。lease 表、过期时间、状态转移全部不需要 |
| 图片 token 估算与 route processing policy 一致（§6.2） | §6.2 | v1 用**按窄 processing profile 的保守分辨率分桶**，保证非零、偏高即可（openclacky 计 0 导致压缩死循环是必须避开的坑）；provider 精确计数推迟，但 fallback 后必须按 active profile 重算 final context 图片成本 |
| active requirement read model（带 projection revision，§7.2） | §7.2 | 砍掉。v1 只做"**草稿含图时**按 catalog 禁用不兼容模型"（纯前端查询）；"历史含图时阻止切模"推迟——切错模型的代价是下一轮 egress gate 一次明确报错 + 引导切回，可接受 |

**C. 明确推迟（v1 不做，合同留位）**

- remote count + provider actual 反馈 + 有界 context rebuild（§6.2）：v1 只用本地 route-aware 保守估算，不调用 pre-materialization remote counter，也不重建上下文；但 active profile 的本地 admission 复核不能推迟，超出原输入预算时必须在 HTTP 前明确失败。
- 多模态摘要（§6.3）：v1 含图消息**一律不进摘要候选**；图片随正常裁剪退出上下文后，requirement 因按 final context 派生而自然解除。
- checkpoint coverage（§6.4）：v1 checkpoint 不 purge 含图消息。
- provider file/upload cache（§4.2）：v1 一律 inline bytes / data URL。
- Chat Completions 工具图片侧车（§16.3）：记录为候选，不实现。

这个分级的判断标准：A 类不做会产生数据损坏或线上事故；B 类的完整机制服务的是"多人长期维护下防止语义漂移"，在 v1 阶段用纯函数与约定即可达到同样语义，等真实需求出现（第三方 route、file cache、精确计费）再机制化；C 类是优化路径，不影响正确性。

### Phase 0 · 清理会破坏附件的现有漂移

> **实施状态**：已完成。五批提交依次为 `c2eca2052`（P0.1）、`2ccb51cc9`（P0.2）、`15ad2838f`（P0.3）、`0181782bf`（P0.4）、`0008517f4`（P0.5）。Phase 0 不新增图片能力，只清除了会让附件合同失真的存量结构。

- 统一 live/window/rebuild user message projection，修复 metadata 双层嵌套，并让存量 ready projection 重新构建。
- 把普通发送、edit-resend、regenerate 改为传递统一用户消息内容聚合；编辑与重新生成使用独立 action，并传递正确的 truncate reason。
- 删除 `aiEngine` 无生产消费者、且实际忽略 capability 参数的旧模型实例 API；不在这里再造一套图片能力门禁。
- 删除 token route 中无消费者的 `supportsImageInput`；Phase 2 再从正确的 model / adapter 合同引入图片能力。
- 删除 `UserMessage.type`、`AgentSpecMessageType` 和 UI message type 中的 `'image'` 历史占位；图片继续作为 `user_input` / `tool_output` 的附件，而不是独立消息类型。

**完成标准**：纯文本行为不变；刷新、编辑重发、重新生成得到同一用户消息结构。

#### Phase 0 代码审计后的实施清单

本节记录 2026-07-22 对 Phase 0 的逐调用链复核和实施结果。Phase 0 没有新增附件字段、引入 `image_input` 或修改 provider adapter；它只清除了会让 Phase 1 合同失真的存量结构。实际按 P0.1 → P0.2 → P0.3 → P0.4 → P0.5 分五次提交，前两项有顺序依赖，后三项独立验证。

##### P0.1 · 修复 user message projection，并重建存量 read model

**已确认的根因链**：

| 路径 | 当前映射 | 结果 |
|---|---|---|
| live SSE / event replay | `projectUserInputEvent` 直接写 `metadata: event.metadata` | `message.metadata.user_quote` |
| window 增量投影 | host `projectUserInput` 写 `payload: { metadata: event.metadata }`，Renderer `mapUiMessageDtoToConversationMessage` 再平铺整个 payload | `message.metadata.metadata.user_quote` |
| rebuild | 与 window 增量投影复用同一个 host projector | 同样双层嵌套 |

修订范围：

1. `src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts`：user row 的 `payload` 直接保存序列化后的 `event.metadata`，不再增加名为 `metadata` 的包装层。`agent_work` 等后续 patch 继续与用户 metadata 位于同一 payload 层。
2. `apps/renderer/domains/conversation/message-window/functions/mapUiMessageDto.ts` 保持“payload 即消息 metadata”的单一语义，不增加兼容性解包分支；旧形状由迁移重建，不在运行时长期兼容两种格式。
3. 新增数据库 v45 数据迁移，把全部 `conversation_ui_projection_state.status='ready'` 标成 `pending`。启动维护任务会先让 API 返回 `preparing`，随后从事实事件重建并替换旧 rows；只改 projector 而不失效 ready 状态会让旧会话永久保留错误结构。
4. 在 `uiProjectionFixtures` 增加真实 `user_quote`、`ui`、`activity` 元数据，扩展 `uiProjectionParity.spec.ts` 的 essential fields；当前 parity 测试只比较 role/type/content，恰好漏过了本次漂移。
5. 增加迁移幂等测试和 SQLite 增量投影 ↔ force rebuild ↔ Renderer window mapper 的模块链测试；断言 `user_quote` 位于单层 metadata，且不存在 `metadata.metadata`。

**验收**：同一 user event 经 live、window、force rebuild 三条路径得到相同 `BaseMessage`；升级旧库后所有会话由启动维护重建，刷新前后的引用块一致。

##### P0.2 · 建立统一用户消息内容聚合，拆开 edit 与 regenerate

当前 `chatFlowOrchestrator` 的问题不止是 reason 写错：

- edit-resend 只逐字段读取并恢复 `user_quote`，未来新增附件后必然再次漏字段；
- regenerate 直接调用 edit-resend，所以始终发送 `truncateReason: 'edit'`；
- `ConversationView` 先更新一次 store，orchestrator 又更新一次，UI 与编排层重复写状态；
- 三层虚拟列表组件重复定义 edit/regenerate payload 联合类型，且保留已不再使用的 `turn` 兼容形状；
- `truncateReason` 目前只进入后端日志，不改变截断算法，因此修正 reason 不应制造第二套 truncate 流程。

修订方式：

1. 在 conversation domain 的 `definitions/` 定义 Renderer 内部 `UserMessageContent` 聚合。Phase 0 只包含 `text` 与可选 `userQuote`；Phase 1 在同一聚合上增加 durable attachments，不另造第二份 durable 用户消息聚合。Phase 4 的方向性调研进一步确认：编辑时“保留旧 attachment ID + 新增 draft ID”必须使用窄上行选择计划，不能把 draft/durable 扩成联合消息类型；commit 后仍回到同一个 `UserMessageContent`。跨 app workflow 的调用者只通过 `assistantService` 的公开类型出口消费 durable 合同，不直接 import conversation 内部 definitions 文件。
2. 在 `functions/` 提供从 `BaseMessage` 读取完整聚合的纯函数。quote 的 snake wire ↔ Renderer 结构转换继续复用 `userQuoteWire.ts`，不让 orchestration 直接逐字段解析 metadata。
3. 普通发送、编辑重发、重新生成统一构造 `UserMessageContent`；其中编辑与重新生成共享一个内部 rerun 编排入口：
   - edit：读取原聚合，只替换 `text`，action 为 `edit`；
   - regenerate：完整复用原聚合，action 为 `regenerate`；
   - 两者仍使用相同的 inclusive truncate 算法，但把 action 原样映射到 `truncateReason`。
4. UI 组件只上报窄命令：编辑为 `{ messageId, text }`，重新生成为 `{ messageId }`。删除 `ConversationView` 的预先 store 更新，由 orchestration 在取消旧流后通过公开 action 一次性同步 live/window 投影。
5. `assistantService` 构造 `new_events[0]` 时只消费统一聚合；禁止继续从 `prompt`、`options.userQuote` 两处分散拼用户内容。其他 `invokeAssistant` 调用者同步构造同一聚合，避免 chat 是特例。

**业务测试**：

- edit 保留 quote、只替换文本、reason 为 `edit`；
- regenerate 保留文本与 quote、reason 为 `regenerate`，且不走编辑分支；
- 从 window-only 用户消息发起两种动作时，live/window 都只更新一次；
- Flow 集成测试继续证明 inclusive truncate 先删除旧 user event，再以同一 event ID 持久化新聚合；分别覆盖 edit 与 regenerate。

##### P0.3 · 删除 `aiEngine` 的虚假 capability API

`src/core/aiEngine.ts` 的真实问题不是一句注释：`getModelInstance(modelId, capability)` 忽略 capability，`getModelInstanceByCapability(capability)` 直接返回第一个模型。全仓没有生产调用者，只有若干测试 fake 为满足 `AIEngine` 大接口而实现这两个方法。

Phase 0 应删除 `AIEngine` interface 与 `AIEngineImpl` 上的这两个死 API、私有 `getAdapterForModel` 以及随之失去用途的 `ModelCapability` / `BaseLLMAdapter` import，并收窄测试 fake。不要在此处补一套基于旧 `ModelCapability.VISION` 的检查：Agent 图片门禁的权威 owner 是 Phase 2 的 model catalog + adapter 声明 + run 前校验，否则会出现两套能力真源。

`aiEngine.ts` 和 `core/types.ts` 仍有更大范围的 `any` 债务，但与这两个死 API 无关的 chat stream / legacy RAG 类型不纳入 Phase 0，后续应单独治理，不能借图片项目顺手重写整个 AI engine。

##### P0.4 · 从 token route 删除 `supportsImageInput`

该字段目前只存在于三处定义/解析代码：

- `packages/linnkit/src/contracts/token-usage.ts`
- `src/domains/model-catalog/definitions/modelCatalog.ts`
- `src/domains/model-catalog/features/catalog-admission/functions/processModelConfig.ts`

全仓没有配置值，也没有运行时消费者；remote token count 只读取 `supportsRemoteTokenCount`。因此 Phase 0 直接删除该字段及 processor 映射，不提供兼容 fallback，也不迁移到另一个临时位置。Phase 2 再一次性增加 model capability `image_input` 与 adapter 的 user/tool-result 两个布尔声明。

**验收**：token route 仍只描述计数、usage、缓存计费等 token 语义；现有 token counter / context manager 测试不变；仓库内 `supportsImageInput` 零命中。

##### P0.5 · 删除独立 `'image'` 消息类型占位

当前 `'image'` 只作为无生产者的枚举值存在于：

- linnkit `UserMessage.type` 与 `AgentSpecMessageType`；
- Renderer `BaseMessage.type`；
- host UI projection / history response / Renderer window DTO guard 的 message type union。

没有 RuntimeEvent、projector、message factory 或业务调用创建这种消息。Phase 1 的目标语义也是“`user_input` / `tool_output` 带有序附件”，不是新增 standalone image message。因此上述 message type 占位全部删除。

以下同名 UI/内容语义不属于占位，必须保留：Markdown AST 的 image node、SSE `content_type='image'`、Renderer 工具图片注册项、Slides element `type='image'`。

**验收**：`createUserMessage('image', ...)` 在类型层不再成立；纯文本 RuntimeEvent、UI read model 与消息渲染行为不变；不新增只锁枚举字段的无意义快照测试。

##### Phase 0 提交顺序与门禁

| 提交 | 依赖 | 主要门禁 |
|---|---|---|
| P0.1 projection parity + v45 rebuild migration | 无 | host projection、migration、SQLite rebuild、Renderer parity/window tests |
| P0.2 user message aggregate + distinct actions | P0.1（先保证 quote 可从刷新历史正确读取） | chat orchestration、assistantService request、Flow edit/regenerate integration |
| P0.3 remove dead AIEngine capability API | 无 | `core` 类型检查、PDF/parser 相关 fake tests |
| P0.4 remove token-route image flag | 无 | model-config processor、token counter、context manager tests |
| P0.5 remove standalone image message type | P0.1 的重建迁移可一并清理旧 projection | linnkit contracts/context harness、UI message window typecheck |

Phase 0 与 Phase 1 已结束。Phase 1 允许新增的“图片”概念只有附件/资源引用；最终实现没有引入 standalone image message、metadata 附件、token route 图片开关或按字段复制附件。后续阶段若重新出现这些表达，应视为偏离本提案并停止扩展。

### Phase 1 · durable 合同与资源引用

> **归档证据**：[`19-multimodal-phase-1-implementation-runbook.md`](./19-multimodal-phase-1-implementation-runbook.md)。该文档记录全链路调研、P1.0–P1.9 实际提交、验收矩阵和风险台账；长期架构结论仍以本文为准。Phase 1 严格采用 §13.0 的 v1 简化方案，没有实现 draft lease、remote count、provider file cache 或多模态摘要。

- 在 `packages/schemas` 建立 Renderer ↔ host 的 `ConversationAttachmentRef`，在 linnkit `contracts` 建立独立的 `RuntimeResourceRef`，Flow host 负责映射。
- `AgentInvokeRequest` 增加 current user event ID；`BaseAgentTask` 停止按 query 文本反查当前轮。
- RuntimeEvent、AiMessage、projection、event converter、runtime replay 全链路携带附件。
- 增加 immutable event asset links 与提交事务；草稿按 §13.0 走受管临时目录（不进 assets 账本，ingress 初始化时清空上次进程的 staging），发送事务时才登记 asset。启动维护只回收早于本进程启动且未进入 `assets` 的最终文件，避免撞上 rename → SQLite 的提交窗口；已登记资源的 GC 基于引用账本 + tombstone 规则（§4.3）。
- UI read model 通过 v47 独立 `attachments_json` 列保存 durable refs；既有 ready projection 失效后从事实事件重建，window 读取不回查 event，也不把附件藏进 payload。Renderer 的 live/window/rebuild、edit/regenerate 均消费同一 durable 用户消息聚合。

**实施结果**：完成。图片-only 与重复文本轮次按 immutable event ID 绑定；图片引用可持久化、刷新恢复、截断和删除；真实草稿经过 Flow、SQLite、window DTO、Renderer 与 force rebuild 保持同一附件身份和顺序；durable event、projection、DTO 与 Phase 1 audit 无 base64、路径、provider file ID 或 draft ID。此状态仍不表示模型已经能识图，真实调用必须先完成 Phase 2 与 Phase 3。

### Phase 2 · 能力、resolver 与运行时校验

> **实施状态**：已完成。全链路调研、Phase 1 审计闭环批次 P2.F、P2.0-P2.9 实际提交、最终 192 项汇总测试与风险台账见 [`20-multimodal-phase-2-implementation-runbook.md`](./20-multimodal-phase-2-implementation-runbook.md)。

能力声明按 §13.0 简化为 model `image_input` capability + adapter 级两个布尔（user 图 / tool-result 图）。三个配置入口一次补齐：

- **内置模型**：由维护者在 catalog 中显式声明；不做运行时名称推断或静默 backfill。
- **自定义模型**：API 与 Ollama 新增/编辑表单都能显式开关"支持图片识别"，默认关闭；后端只接受明确可编辑字段并统一归一化 capabilities，未知扩展值不会因编辑图片能力而丢失。
- **Linnya Cloud**：Worker 与 admin 枚举已加入 `image_input`；admin 保存、Worker `/v1/models` 下发与 desktop `ModelConfig` 转换保持同一能力数组，未知扩展 capability 不会让整份 payload 失效，默认配置仍不自动增加图片能力。

运行时部分：

- 每次真实调用前，对 final context 用纯函数派生图片要求并校验 active model + adapter 声明（覆盖显式选模、policy fallback、quota fallback、wait-user、child run——全部走同一个校验点，见 §13.0）。
- 建立 §11 的稳定 domain error code 与 Renderer 文案（"当前模型不支持图片 + 兼容模型列表"），能力错误不再依赖 provider 字符串倒推。
- `call`、`callStream`、`callWithRetries` 和每个真实 retry attempt 共享同一校验；policy 与 quota fallback 均保持本次 requirement，不兼容时不重放带图消息。
- host `AIEngine` 在 AdapterFactory、policy、请求日志、HTTP audit 与 fetch 前阻断未物化 durable ref，填补 Phase 3 converter 尚未落地的真空期。

**实施结果**：完成。三个入口都能声明 `image_input` 且默认关闭；模型语义能力与 adapter placement 是两层事实；任何切模或 fallback 都不能把图片 run 降到不兼容模型；user 与 tool-result placement 独立判断；能力错误以三个稳定 code 经过 AgentEvent、RuntimeEvent、SSE 与 durable replay 到达 Renderer。所有 production adapter 的两个 placement 在 Phase 2 终态仍为 `false`，因此此状态只证明安全门禁和错误解释已打通，不表示 Agent 已经能识图。

### Phase 3 · Context Manager 与 provider adapter

> **实施归档**：全链路代码与 provider surface 调研、P3.0-P3.11 批次、业务测试矩阵、风险台账和最终验收见 [`21-multimodal-phase-3-implementation-runbook.md`](./21-multimodal-phase-3-implementation-runbook.md)。Phase 3 只开放用户图片；工具结果图片的生产、schema 过滤和 ToolNode 二次校验仍属于 Phase 5，因此所有 route 的 `tool_result_image` 在本阶段继续保持 `false`。

- 消息与附件原子保留、保守分桶估算、trace 落地；摘要与 checkpoint 按 §13.0 简化：含图消息不进摘要候选、checkpoint 不 purge 含图消息（多模态摘要与 coverage 推迟）。
- 新增 host attachment resolver / materializer port；materializer 按当前 workspace 装配，在 `LlmCaller` 每个 active model attempt 的能力校验后执行，不绑定应用级 `AIEngineImpl` 单例。`LlmRequestMessage` 继续是 durable caller 输入，`AgentAiEngine` 改为只接受 resolved input，禁止用联合类型或 overload 保留 durable 旁路。
- 按仓库真实 API surface 分别实现 typed converter：`gpt` 是 OpenAI Responses；`gemini`、`openrouter` 和 generic `openai` 是 OpenAI-compatible Chat Completions；`claude` 是 Anthropic Messages；`ollama` 是原生 Chat API。v1 一律 inline bytes/data URL，不接 provider file cache，也不为当前非 native 的 Gemini route 实现 `inlineData`。
- 收紧本阶段触达的 adapter request/converter 类型边界并删除对应重复局部类型，不扩大成全量 adapter `any` 治理。
- 补 lifecycle audit/tool replay 的可回放 durable 投影；`LLMHttpClient.lastRequestSnapshot` 也不得继续保存完整 provider body，各 API surface 在 policy 后用自己的窄 projector 产出安全调试投影。
- 用 host-owned 的窄图片 processing profile 让本地尺寸分桶估算、route limit 和 converter 参数同源；linnkit Context Manager 只通过 provider-neutral estimator port 取得估算值与 safe profile ID，不反向依赖 host profile/adapter descriptor。该 profile 不替代 model `image_input` 与 adapter placement 两层能力真源。
- fallback 切换 profile 后，用 Context Manager 产出的 admission evidence 重算 final context 图片成本并复核原输入预算；只校验、不在 retry loop 内重建上下文。
- remote count + provider actual 反馈 + 有界 context rebuild 按 §13.0 推迟；本地 active-profile admission 复核已纳入 Phase 3。

**完成标准**：同一张持久化图片可经过各已声明 adapter 发送；未实现的 adapter 默认不声明能力；审计与日志两层都不含图片字节。

**实施结果**：完成。用户图片现可由 durable event 经 Context Manager 图片预算、active-profile admission、workspace 完整性解析与短生命周期物化，进入 Chat Completions、OpenAI Responses、Anthropic Messages 和 Ollama 四类 typed surface；流式与非流式共用各自 request builder。摘要不跨含图轮次，checkpoint 原子保留含图工具组，fallback/retry 每次重验并重新物化，wait-user 使用新一轮附件，child 默认不继承父图、只有显式传递才启用完整图片链。最终真实 Flow fixture 已从 draft/SQLite 刷新恢复打到 provider mock body；34 个文件 204 项定向测试与静态门禁通过。production `tool_result_image` 仍全部关闭，durable/audit/debug/log 不含 bytes、base64、data URL 或本地路径。完整提交与验收见 21 号归档。

### Phase 4 · 用户输入

- 新增 conversation 内建附件 feature。
- 完成选择、粘贴、拖拽、图片-only、预览、删除、上传和 preflight。
- 模型下拉：草稿含图时按 catalog 禁用不兼容模型并说明原因（active requirement read model 按 §13.0 砍掉；历史含图的切模限制推迟，由 egress gate 报错兜底）。
- 完成编辑重发、重新生成和历史资源异常交互。
- 先把 edit/regenerate 的 inclusive truncate + 新 user event append 收成 EventStore 单事务，再开放附件编辑；既有 attachment 只按目标消息内的 attachment ID选择，host 验证归属。
- 普通发送不把 draft ref写入 Renderer 消息；host durable commit 后、Agent 开始前通过 app-level `user_input_committed` 确认驱动 live/window 投影和草稿清理。
- 历史图片只按 asset ID经过鉴权 preview endpoint 和 Phase 3 同源完整性校验，不暴露本地路径或通用静态目录。

**完成标准**：ingress 失败不清草稿、不写 user event；egress 失败保留 failed run 与消息以便重试；刷新后附件一致。

**实施归档**：全链路代码事实、P4.0-P4.10 批次、提交确认、原子 replace、preview、安全门禁和测试矩阵见 22 号 runbook。

**实施结果**：完成。用户图片可由选择、粘贴或拖拽进入 workspace-scoped 草稿；三入口共用 staging/count/extension 纪律，paste保留普通文本，drop非图片由host逐项拒绝。模型下拉和发送前置校验只消费显式 `image_input` 能力。普通发送冻结有序 draft snapshot，不写 optimistic 消息；host 完成 durable 事务并释放草稿后发送独立 commit ack，Renderer 再投影 durable refs、清 composer、生成标题并同步历史。图片-only 输入已合法，commit 前失败保留完整草稿，provider 失败则保留已提交消息，regenerate复用原附件。刷新或窗口加载后的 durable 图片按 asset ID 经鉴权 preview endpoint 和同源完整性校验显示，gallery 固定几何并复用通用 Modal。编辑支持 existing 删除/排序和新 draft 添加/重试/取消，host 校验目标归属并原子合并；重新生成固定 preserve。两者都只在 replace ack 后更新 live/window，失败不制造未落库的 optimistic 历史。普通 composer归workspace并跨临时remount保留，edit session绑定conversation；app close依赖Renderer runtime销毁和host下次启动清staging。staging/preview错误由item inline展示，commit及执行链错误进入ErrorBanner并共用稳定中英文映射。最终 Renderer → host → SQLite → Context Manager → materializer → provider → history/preview 真实 fixture、桌面与窄窗口 Browser 验收、52 个文件 297 项业务回归和静态泄漏门禁全部通过；`tool_result_image` 继续全部关闭。

### Phase 5 · 工具图片与 `resource_read`

- 工具定义增加 requirement，结果增加 `modelInput.attachments`。
- prepare 过滤与 ToolNode 执行校验。
- `resource_read` 对真实图片资源返回统一附件引用。

**完成标准**：文本资源不受影响；图片资源只在兼容 route 中进入模型。

**实施归档**：全链路代码事实、工具/asset三层合同、active-model与fallback门禁、幂等重放、`resource_read` asset URI、首批Responses/Anthropic converter、P5.0-P5.11批次、真实Agent loop和风险台账见 [`23-multimodal-phase-5-implementation-runbook.md`](./23-multimodal-phase-5-implementation-runbook.md)。Phase 5 v1已完成：只引用已登记workspace asset，不接受工具本地路径或隐式文件ingress；Chat Completions、OpenRouter、Gemini-compatible与Ollama工具图片继续关闭。长期接入合同已经迁移到稳定provider/tool文档，23号只保留实施证据。

### Phase 6 · Slides/bash CLI

- CLI 负责渲染、截图和结构诊断，输出稳定 asset/manifest。
- `resource_read` 或通用工具结果附件链负责把截图交给模型。
- 不新增 PPT 专用 AI 检查工具。

**实施归档**：全链路代码事实、截图产物归属、同源 raster/hidden worker、CLI manifest、通用 command artifact claim、GC、深度审计修复与 P6.0-P6.9 批次见 [`24-multimodal-phase-6-implementation-runbook.md`](./24-multimodal-phase-6-implementation-runbook.md)。Phase 6 已完成并通过真实 Electron 产品链复验：生产 Slides Agent 可调用受控 CLI，截图经 asset/claim 和 tool event 建立会话归属，重启后可由 `resource_read` 再次读取并进入 provider；CLI 输出文件、会话 tool asset 与项目资源库成员继续保持三种不同语义，只有显式资源库动作写 `project_asset_links`。长期合同已迁入稳定 README，24 号只保留实施证据。

**完成标准**：命令行既可供人和 CI 使用，也可由 Agent 调用；图片仍走统一上下文生命周期。

顺序上的核心判断是：**先让 Agent 真正具备图片上下文，再开发截图 CLI**。两者相辅相成，但 CLI 只是生产图片；没有 Phase 1–5，它生成的截图仍只是磁盘文件，Agent 看不见。

---

## 14. 测试策略

不写 UI 样式快照或字段定义快照作为主要保障，重点做跨模块业务链路：

1. 用户图片从导入、event、projection、context build 到各 provider adapter。
2. 图片-only 消息。
3. 刷新恢复后 live/window/rebuild projection 一致。
4. edit-resend / regenerate 保留同一 asset，删除附件产生正确新引用。
5. 显式切模、policy fallback、quota fallback 均保持 modality + placement requirement。
6. 无兼容 fallback 时明确失败且不丢图片。
7. user-content-only route 可发用户图片但不暴露图片工具；支持 tool-result 的 route 才允许工具图片进入下一轮。
8. `resource_read` 文本路径不受影响，图片路径按能力分支。
9. 含图消息不进摘要候选、不被 checkpoint purge；图片被正常裁剪退出上下文后，下一轮调用不再要求 `image_input`（多模态摘要与 coverage 的测试随特性推迟）。
10. wait-user 恢复与 child run 显式附件传递。
11. 缺失、损坏、hash 不一致、provider 限额错误。
12. 草稿临时文件的孤儿清理、发送事务登记 asset、truncate、会话删除、共享引用和 tombstone GC。
13. audit、telemetry、event payload 不含 base64/data URL/raw bytes。
14. 图片 token 保守分桶估算非零并进 ContextTrace；provider usage 图片分项仅在明确给出时记录（remote count 测试随特性推迟）。
15. current user event ID 正确覆盖图片-only 和重复文本消息。
16. 错误 UX：能力校验失败产生稳定 domain code，Renderer 展示"当前模型不支持图片 + 兼容模型列表"而非泛化文案；provider 兜底报错分类为不可重试，不触发带图重试、不进入 quota fallback 重放。
17. 能力配置入口：自定义模型勾选与 Linnya Cloud capability 下发都能进入本地 catalog，并被选模校验与模型下拉禁用逻辑消费。

建议以 linnkit contract/invariant tests + host adapter contract tests + conversation 端到端模块测试三层覆盖；provider live smoke test 只验证已配置 route，不作为离线主测试的唯一保障。挂靠点沿用现有基建：合同与物化在 linnkit testkit（context harness）与 `src/infra/adapters/llm/__tests__/`；宿主持久化与 projection 一致性在 `src/app-hosts/linnya/adapters/flow/__integration-tests__/` 与 renderer `uiProjectionParity.spec.ts`；Renderer 编排在 `chatFlowOrchestrator` 既有测试族；错误 UX 在 `errorNormalizer` 测试与 fallback 边界测试。

---

## 15. 决策记录

| 决策 | 结论 | 原因 |
|---|---|---|
| 图片是否只是 Slides 能力 | 否 | 用户输入、工具、历史、fallback 都有同一需求 |
| `content` 是否改 provider parts | 否 | 污染 framework 且绑死 provider 生命周期 |
| 持久化什么 | 文本 + durable resource 引用 | 稳定、可回放、可 GC |
| 图片字节存哪里 | 复制进 app 受管目录（content-addressed），SQLite 只存元数据，消息只存引用 | DB blob 会膨胀拖垮备份与查询；引用用户原路径会因删除/移动死链；复制后用户删原图不影响后续对话（§4.3） |
| 何时读取 bytes | 最终 route 确定且 context 已选好之后 | 缩短敏感数据生命周期，避免无用 I/O |
| 能力名称 | `image_input` | 与 OCR `vision`、图片生成区分 |
| 能力从哪里来 | 显式 model 能力 + route egress profile | 不靠模型名猜测，也不混淆 user/tool placement |
| 不兼容模型怎么办 | 阻止运行 | 不静默丢图、不隐式降级 |
| 工具图片放哪里 | `modelInput.attachments` | 不改变 `media` 的 UI 语义 |
| 摘要能否忽略图片 | 不能 | 否则解除 requirement 没有语义依据 |
| CLI 与图片能力顺序 | Agent 生命周期先行，CLI 后接入 | CLI 是生产者，不是传输和上下文系统 |
| 能否只靠 provider 报错代替能力门禁 | 否；provider 报错仅作最后 fail-closed 防线 | 报错结局不统一（400/静默丢图/本地异常）、发生在消息入库后会污染历史、重试与 quota fallback 会放大失败；论证见 §3.1 |
| 无视觉模型是否自动 OCR 降级 | 否 | OCR 静默改变语义（openclacky 走此路线但需 sidecar 模型 + 防幻觉文案配套）；我们选择明确报错 + 引导切模，语义更诚实 |
| 工具图片在 Chat Completions route 上是否用注入 user 消息侧车 | 首期否，记录为未来候选 | 改变消息来源语义；优先支持原生 tool-result 协议的 route（见 §16.3） |
| route egress profile 是否 v1 实现 | 不实现完整矩阵；能力降为 adapter 级两个布尔，处理事实用 host-owned 窄 profile | 估算、limit 和 converter 参数必须同源，但不提前引入第三方 transport/file cache 矩阵；见 §13.0 |
| requirement 是否需要独立状态机 | 否，每次调用前对 final context 用纯函数派生 | 重算天然满足"只增不减/跨 run 重派生/恢复重验"，机制无增量价值；见 §13.0 |
| 草稿资源是否需要 draft lease | 否，草稿走受管临时目录，发送事务时才登记 asset | 草稿不进账本就没有"未提交资源被 GC 抢删"问题；见 §13.0 |
| remote count / 多模态摘要 / checkpoint coverage / provider file cache | v1 推迟 | 本地 active-profile admission、摘要/checkpoint 图片屏障仍必须实现；推迟的是 provider actual 反馈、重建和多模态内容生成；见 §13.0 |

---

## 16. 同类产品调研

调研日期：2026-07-22。前三个为本机 `~/code/` 下可读源码的项目，逐仓做了代码级调研；§16.4 为公开资料调研。结论用于校准本提案的取舍，不照抄任何一家。

### 16.1 AionUi（Electron 多 agent 桌面应用）

图片链路：粘贴/拖拽/选择 → HTTP 上传落盘 → 消息 content 里追加 `[[AION_FILES]]` 文本标记 + 路径列表，SQLite 只存文本；发送时另传 `files: string[]`；agent 侧按 ACP `promptCapabilities.image` 组装 `ImageContent`。UI 回放按路径懒加载 base64。

| 做对了 | 做错了 |
|---|---|
| 历史只存路径、不存 base64；工具输出 > 64KB 的 base64 会被 omit 并保留落盘路径 | 附件塞进文本标记 `[[AION_FILES]]`，输入历史（ArrowUp）会把标记带回输入框 |
| 展示与发送分离（`files[]` 给后端、标记给 UI） | ACP 有 `promptCapabilities.image`、模型有 vision 正则标记，但**全都没接到输入 UI**，用户可对任何 agent 贴图，失败后置 |
| 粘贴统一走落盘管线 | 不允许图片-only 消息；格式白名单 `isSupportedFile` 恒 true 空转；历史与文件生命周期脱钩（删文件即死路径） |

### 16.2 open-design（Codex/OpenCode 包装的设计应用）

图片链路：附件上传进**项目目录**，消息只存 `{ path, name, kind }` JSON；主路径不做原生多模态注入，而是在 prompt 里给编号路径提示，让 coding agent 用文件工具自己读图。原生注入（`imagePaths` → base64/ACP resource_link）只覆盖少数声明了 `supportsImagePaths` 的 runtime，Web 端几乎不用。

| 做对了 | 做错了 |
|---|---|
| 项目目录作为资产真相源，消息存引用；会话 DB 轻 | 双通道割裂：项目附件 vs `imagePaths`，后者对日常粘贴基本空转，"附件=多模态"的产品叙事与实现不符 |
| 标注回传用"截图 + selector/bounds 结构化定位"双轨，截图失败仍可定位 | 没有模型级"能否看图"门禁；路径提示 ≠ 模型真的看了图，失败体验不可控 |
| resume 有 identity guard（model/cwd 变了就重播） | transcript 只有文本，resume 失效重播时历史图片上下文丢失；`od-uploads` 临时目录无 GC |

对本提案的直接印证：它的"路径提示 + agent 自己读文件"是一条真实存在的替代路线（相当于把图片输入降级成 `resource_read` 工具调用），适合包装外部 CLI agent 的产品，但对我们这种自己控制 provider 调用的框架，等于放弃了对"模型是否真的看到图"的可观察性，不采用为主路径。

### 16.3 openclacky（Ruby CLI agent，BYOK 任意 OpenAI-compatible 模型）

三家中能力体系最完整的一个。图片链路：多入口统一为内部 OpenAI 风格 `image_url` data URL；provider 级 `capabilities.vision` + 模型级覆盖；发送前统一降采样（宽 800px）+ 5MB 硬限。

三层防御结构值得研究：

1. **入站**：无 vision 能力时尝试 OCR sidecar（独立视觉模型转文字），失败则降级为磁盘引用并在 prompt 中明确"不要猜图内容"。
2. **工具图**：`image_inject` 侧车——工具结果只放文本，图片由 agent 收口后**追加一条 `system_injected: true` 的 user 消息**携带 `image_url`。原因注释写得很清楚：OpenAI-compatible API 只接受 user 消息里的图片，塞进 tool role 会被当文本 JSON 编码，token 膨胀 20–40 倍。
3. **出站兜底**：请求发出前若历史里仍有 `image_url` 而当前模型无 vision，替换为 `"[Image content removed — current model does not support vision input]"` 占位文本，防 400；有针对"模型中途切换"的回归测试。

| 做对了 | 做错了 |
|---|---|
| 能力按**本次请求的实际模型**解析（防切模后用旧缓存） | session.json 内联完整 base64，长会话膨胀 |
| 出站 strip 防污染历史导致的永久 400 | token 估算对图片计 0，曾导致压缩死循环 |
| 降级失败时 prompt 明确禁止幻觉 | 未知自定义 endpoint 默认 vision=true，可能硬 400 |

**对 §9 的直接启发**：openclacky 的 `image_inject` 侧车是"OpenAI Chat Completions 的 tool message 不等价支持图片"（§9 表格）的一个现实解法——把工具图片改写为注入的 user 消息。本提案首期不采用（它改变了消息来源语义，且我们优先支持 Responses/Anthropic/Gemini 的原生 tool-result 图片协议），但它可以作为未来给"仅支持 user_content 的 route"补上工具图片能力的候选方案，记录在案。

### 16.4 业界公开行为（Cline / Codex CLI / OpenClaw / opencode）

- **Cline**：每模型显式 `supportsImages` 开关，驱动文件选择器/粘贴/拖拽三个入口的 UI 门禁。其公开 bug 史是本提案 §3.1 的最好论据：粘贴入口曾漏掉检查，图片发给纯文本模型后自动重试 3 次才失败（issue #8635）；VSCode LM provider 硬编码 `supportsImages: false` 又误杀了实际支持视觉的模型（issue #7743）——印证"能力必须显式配置、且配置必须可由用户修正"。
- **Codex CLI**：`--image` 参数 + 粘贴 + 拖拽；图片随 session 持久化并跨 resume 保留；明确的格式白名单（PNG/JPEG/GIF/WebP，与本提案 §10.2 接近）。公开 issue 抱怨"聊天附件对 agent 工具链不可见（没有本地文件路径）"——印证本提案"附件必须进入受管存储并可被 resolver 解析"的设计。
- **OpenClaw**：网关层 `resolveGatewayModelSupportsImages` 按 catalog 声明的 `modalities.input` 判定，判 false 则在解析附件时明确抛 `UnsupportedAttachmentError`。其大量误判 issue 的根因都是**硬编码 provider 名称白名单**，后续修复全部收敛到"catalog/config 显式声明"——与本提案 §5.1"禁止按名称猜测"一致。早期版本静默丢图被用户当作严重 bug 报告。
- **opencode / kilocode**：`capabilities.input.image` 来自 `modalities` 配置；不支持时 `unsupportedParts()` 在发送前把图片 part 替换为错误文本。自定义 provider 未声明 modalities 时默认 false，导致真视觉模型被误禁——印证本提案"自定义模型默认不支持 + 设置页显式开关"必须配套明确的用户可见提示，否则会变成"为什么我的模型发不了图"的支持负担。

### 16.5 跨产品共识

1. **历史存引用、不存 base64**：所有做对的产品都遵守；openclacky 的 session 膨胀是唯一反例且被列为坑。本提案 §4.1 一致。
2. **能力必须显式配置且驱动 UI**：AionUi 与 open-design 的共同缺口都是"标记存在但没接 UI"；Cline/OpenClaw 的 bug 史证明能力判断不能靠名称推断。本提案 §5.1、§7.2 一致。
3. **"直接发送等报错"没有一家作为主策略**：要么 UI 门禁（Cline），要么网关预检（OpenClaw/opencode），要么降级+出站 strip（openclacky）。§3.1 结论由此支撑。
4. **图片 token 计数被普遍低估**：openclacky 计 0 导致压缩死循环。本提案 §6.2 的 route-aware 估算不是过度设计。
5. **本提案独有、同类都没做好的部分**：附件与消息的原子生命周期（摘要/checkpoint/编辑重发）、图片-only 消息、draft lease 与 GC。这些是差异化投入，也是工作量主体。

---

## 17. 官方协议来源

访问日期：2026-07-22。实施时仍需针对具体 SDK 版本和 API surface 复核。

### OpenAI

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)：Responses API 使用 `input_image`，Chat Completions 使用 `image_url`；图片可来自 URL、base64 data URL 或 Files API file ID；支持多图并计入 token。
- [Responses API reference](https://developers.openai.com/api/docs/api-reference/responses)：实施 typed converter 时的权威字段来源。
- [Chat Completions API reference](https://developers.openai.com/api/docs/api-reference/chat)：不能与 Responses content parts 混用。

### Anthropic

- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision)：支持 base64、URL 与 Files API；格式、大小和像素限制依 API surface 而异。
- [Files API](https://platform.claude.com/docs/en/build-with-claude/files)：file ID 有 provider 生命周期，只适合作为 adapter cache。
- [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)：工具结果图片需要遵守 `tool_result` block 协议。

### Gemini

- [Image understanding with generateContent](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)：generateContent 使用 inline data 或 file data。
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)：实现工具结果图片时复核 function response 的 part 与传输限制。
- [Files API](https://ai.google.dev/gemini-api/docs/files)：文件有 provider 生命周期，不能成为 durable history 真源。
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)：图片 token 与媒体分辨率策略有关。
- [Tokens](https://ai.google.dev/gemini-api/docs/tokens)：优先使用 countTokens 和 response usage，不在 framework 写死换算规则。

---

## 18. 评审结论与下一步

本提案建议通过以下架构方向：

1. 采用“持久层 asset 引用 + 出口层临时物化”的双层合同。
2. 用显式 `image_input`（内置 catalog / 自定义模型勾选 / Linnya Cloud 勾选三个入口）+ adapter 能力声明 + 调用前纯函数派生校验，贯穿选模、fallback、工具和 context build。
3. 能力门禁为主策略，provider 报错只作最后 fail-closed 防线（§3.1）；不采用自动 OCR 降级与静默丢图。
4. 按 §13.0 的复杂度分级实施：v1 保留全部语义，把 route profile、requirement 状态机、draft lease 等机制降为函数与约定，remote count、多模态摘要、checkpoint coverage 推迟。
5. 先修 projection/edit/regenerate 等会破坏消息聚合的存量漂移。
6. 按 Phase 1–5 打通 Agent 图片生命周期，再让 Slides/bash CLI 接入统一资源通道。

后续继续为每个 Phase 单独维护实施计划和提交，不在一个改动里同时重写消息协议、UI、provider adapter 与资源存储。Phase 1-5 已分别归档于 19-23 号 runbook；Phase 4 只把用户选择、粘贴、拖拽、预览、删除、异步校验与发送状态接入已经验收的 durable → context → materializer → provider 主链，并关闭了 edit/regenerate 原子性与 durable commit ack 两个事实层缺口，没有设计第二套上传、图片消息或 converter 协议。任何 adapter placement 仍只能和对应 converter 及 provider request body 测试同批从 `false` 翻为 `true`；`tool_result_image` 已按 23 号 P5.8/P5.9 仅对 Responses/Anthropic route 开放，具体模型只需声明统一的 `image_input` 能力。
