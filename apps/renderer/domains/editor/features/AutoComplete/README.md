# AutoComplete 自动补全模块

AI 驱动的文本自动补全功能，基于 Tiptap 扩展实现。

## 功能特性

- **智能补全**：基于上下文预测并续写文本
- **补全长度控制**：支持短（1句话）、中（2-3句话）、长（1段话）三种长度
- **拒绝反馈机制**：记录被拒绝的建议，避免重复推荐
- **频率控制**：可配置触发延迟和触发频率
- **段落内补全**：支持在段落中间触发补全

## 架构说明

本模块采用**模块化架构**，遵循单一职责原则，实现高内聚、低耦合的设计。

### 目录结构

```
AutoComplete/
├── Autocomplete.js                        # 主扩展文件 (约 480 行)
├── config/
│   └── contextConfig.ts                   # 上下文获取配置
├── services/                              # 服务层（核心业务逻辑）
│   ├── AutocompleteStateManager.ts        # 状态管理服务
│   ├── AutocompleteAiService.ts           # AI 请求处理服务
│   ├── AutocompleteTriggerManager.ts      # 触发控制服务
│   └── RejectionTracker.ts                # 拒绝反馈追踪服务
├── handlers/                              # 事件处理层
│   └── AutocompleteEventHandler.ts        # 编辑器事件处理
├── ui/                                    # UI 层
│   └── AutocompleteSuggestionWidget.ts    # 建议 Widget 创建
├── types/
│   └── index.ts                           # 共享类型定义和配置常量
├── README.md                              # 功能说明文档
├── MIGRATION.md                           # 重构迁移指南
└── TESTING_CHECKLIST.md                   # 测试清单
```

### 架构分层

```
┌─────────────────────────────────────────┐
│     Autocomplete.js (主扩展)             │  ← 组合层：协调各服务
├─────────────────────────────────────────┤
│  Services (服务层 - 独立可测试)          │
│  ├─ StateManager      (状态管理)        │
│  ├─ AiService         (AI 请求)         │
│  ├─ TriggerManager    (触发控制)        │
│  └─ RejectionTracker  (拒绝追踪)        │
├─────────────────────────────────────────┤
│  Handlers (事件处理层)                   │
│  └─ EventHandler      (事件处理)        │
├─────────────────────────────────────────┤
│  UI (视图层)                             │
│  └─ SuggestionWidget  (建议显示)        │
└─────────────────────────────────────────┘
```

## 核心模块说明

### Autocomplete.js (主扩展)

**职责**：作为 Tiptap 扩展入口，组合各服务模块完成补全功能

**主要功能**：
- 初始化服务实例（StateManager, TriggerManager, AiService 等）
- 注册 ProseMirror 插件（Decoration 管理）
- 注册命令（Tab 键接受建议）
- 协调服务模块完成补全流程

**代码量**：约 480 行（重构前 670 行，减少 28%）

**向后兼容**：通过 `syncStateToStorage()` 保持与原 storage 结构兼容

### config/contextConfig.ts

上下文获取配置：
```typescript
export const AUTOCOMPLETE_CONTEXT = {
  blocksBefore: 5,         // 获取前面5个块
  blocksAfter: 1,          // 获取后面1个块
  charsLimitBefore: 300,   // 前文限制300字符
  charsLimitAfter: 200,    // 后文限制200字符
};
```

### services/AutocompleteStateManager.ts

**职责**：集中管理自动补全的所有状态

**功能**：
- 管理 loading、suggestion、error 状态
- 管理 AbortController（用于取消请求）
- 管理建议显示时间戳（用于频率控制）
- 提供状态重置和清理方法

**API**：
```typescript
class AutocompleteStateManager {
  getState(): Readonly<AutocompleteState>
  setSuggestion(suggestion: string, pos: number): void
  clearSuggestion(): void
  setLoading(loading: boolean): void
  setError(error: string | null): void
  abortRequest(): void
  reset(): void
  clearWithDispatch(view: EditorView, pluginKey: PluginKey): void
}
```

### services/AutocompleteAiService.ts

**职责**：处理所有 AI 请求相关逻辑

**功能**：
- 收集编辑器上下文（前后文本）
- 调用统一 AI 服务接口
- 处理响应和错误
- 验证上下文是否足够

**API**：
```typescript
class AutocompleteAiService {
  static async requestSuggestion(
    editor: Editor,
    params: AutocompleteRequestParams,
    signal: AbortSignal
  ): Promise<AutocompleteResponse>

  static async validateContext(
    editor: Editor,
    minLength: number
  ): Promise<boolean>
}
```

### services/AutocompleteTriggerManager.ts

**职责**：管理补全触发的所有控制逻辑

**功能**：
- 防抖控制（debounce）
- 全局开关检查
- 编辑器状态检查（可编辑、光标选区）
- 段落内补全检查
- 频率限制检查

**API**：
```typescript
class AutocompleteTriggerManager {
  createDebouncedCall(callback: () => void): void
  trigger(): void
  cancel(): void
  checkGlobalEnabled(): TriggerCheckResult
  checkAllConditions(view: EditorView, lastTimestamp: number | null): TriggerCheckResult
}
```

**触发条件综合检查**：
1. 全局开关已启用
2. 编辑器可编辑且选区为光标
3. 满足段落内补全设置
4. 未触发频率限制

### services/RejectionTracker.ts

**职责**：追踪和管理被拒绝的补全建议

**功能**：
- 记录最近被拒绝的建议（最多 2 条）
- 2 分钟自动过期
- 记录用户拒绝后继续输入的文本
- 提供给 AI 避免重复建议

**API**：
```typescript
class RejectionTracker {
  addRejection(suggestion: string, suggestionPos: number, userContinued?: string): void
  getRecentRejections(): RejectedSuggestion[]
  getRejectionsForApi(): RejectionForApi[]
  clear(): void
}
```

**拒绝场景**：
- 用户编辑文档（输入、删除字符）
- 用户移动光标（方向键、鼠标点击）
- 用户执行其他操作导致选区变化

### handlers/AutocompleteEventHandler.ts

**职责**：处理编辑器状态变化和事件

**功能**：
- 检测文档变化和选区变化
- 判断是否是拒绝场景
- 提取用户拒绝后的输入文本
- 判断是否应该触发新补全

**API**：
```typescript
class AutocompleteEventHandler {
  static detectChange(prevState: EditorState, currentState: EditorState): EditorChangeInfo
  static checkRejection(
    changeInfo: EditorChangeInfo,
    hasSuggestion: boolean,
    prevState: EditorState,
    currentState: EditorState
  ): RejectionInfo
  static shouldTriggerNewCompletion(
    changeInfo: EditorChangeInfo,
    currentState: EditorState
  ): boolean
}
```

### ui/AutocompleteSuggestionWidget.ts

**职责**：创建建议显示的 UI Widget

**功能**：
- 创建 ProseMirror Decoration Widget
- 设置样式（灰色、不可编辑、不可选中）
- 配置 Widget 属性（位置、唯一标识）
- 解析建议文本中的 **Markdown 语法**（仅用于占位符展示）

**API**：
```typescript
export function createSuggestionWidget(pos: number, text: string): Decoration
```

#### 占位符的 Markdown 渲染说明

自动补全建议（灰色占位符）在展示阶段会尝试解析 Markdown（例如 `**加粗**`、`` `code` ``、`~~删除线~~`）：

- **渲染策略**：先同步用纯文本显示，随后异步调用 `markdownService.parseMarkdown(text, 'html')` 解析为 HTML。
- **安全策略**：对解析出的 HTML 使用 `DOMPurify.sanitize` 清理，避免 markdown 中夹带 raw HTML 造成注入风险。
- **布局策略**：由于占位符是内联 `<span>`，对常见的 `<p>...</p>` 块级外壳做了内联化处理，多段内容以 `<br/>` 连接。
- **行为约束**：该渲染主要影响“占位符展示”。当用户按 Tab 接受建议时，会将建议中的**行内 Markdown（受控子集：bold/italic/strike/code）转换为对应 marks** 后插入编辑器；不在该子集内的 Markdown 仍会按纯文本插入。

### types/index.ts

**职责**：提供共享类型定义和配置常量

**内容**：
- `RejectedSuggestion` - 被拒绝的建议记录类型
- `AutocompleteContextConfig` - 上下文配置类型
- `AUTOCOMPLETE_CONFIG` - 全局配置常量（拒绝队列、触发条件等）
- `AiSettingsStoreMinimal` - AI 设置 Store 的最小接口
- `CompletionLengthLevel` - 补全长度等级类型

## 用户设置

设置存储在 `aiSettings` store 中：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `isAutocompleteEnabled` | `false` | 总开关 |
| `isIntraParagraphCompletionEnabled` | `true` | 段落内补全开关 |
| `delayLevel` | `3` | 延迟等级 (1-5)，对应 500ms-4000ms |
| `frequencyLevel` | `3` | 频率等级 (1-6)，对应 0-~3分钟间隔 |
| `completionLengthLevel` | `2` | 补全长度 (1=短, 2=中, 3=长) |

### 延迟等级映射

| 等级 | 延迟 | 描述 |
|------|------|------|
| 1 | 4000ms | 极慢 |
| 2 | 2500ms | 较慢 |
| 3 | 1500ms | 中等（默认） |
| 4 | 1000ms | 较快 |
| 5 | 500ms | 极快 |

### 补全长度映射

| 等级 | Prompt 提示 | 描述 |
|------|-------------|------|
| 1 | Output exactly 1 short sentence. | 短（1句话） |
| 2 | Output 2-3 sentences. | 中（2-3句话，默认） |
| 3 | Output a full paragraph. | 长（1段话） |

## 工作流程

```
用户输入
    ↓
防抖触发 (delayLevel 控制)
    ↓
频率检查 (frequencyLevel 控制)
    ↓
getAutocompleteStructuredContext() 收集上下文
    ↓
generateText() → POST /api/v1/conversation/next
    ↓
后端 AutocompleteTask.buildMessages() 构建 prompt
    ↓
AI 模型生成
    ↓
Decoration Widget 显示建议
    ↓
Tab 接受 / 继续输入拒绝
```

---

## 用户行为追踪与意图预测（规划）

> 目标（中文）：从“文本预测（续写）”演进到“意图预测（先判断用户在写什么/要做什么，再决定是否补全、如何补全）”，提升命中率与可控性，减少打扰。

### 为什么需要行为追踪

自动补全属于高频、低延迟能力。仅靠静态上下文（`context_before/context_after`）会遇到以下问题：

- **编辑状态不稳定**：用户正在大段删除/粘贴/移动光标时，强行触发补全容易打扰，且命中率低。
- **结构性写作**：标题/列表/分隔符等结构变化，本质是“结构编辑”而非“文本续写”，需要不同策略。
- **重写信号**：大段删除通常意味着用户否定刚刚的写法，AI 继续沿旧思路续写会更容易偏离。

因此我们需要一个轻量的“行为窗口”来判断当前是：**续写**、**收尾**、**列点**、**重写**、还是**结构调整**。

### 设计原则（必须遵守）

- **高内聚低耦合**：行为追踪只记录事实，不直接依赖 AI 请求实现细节。
- **最小数据原则**：不记录全文、不回传敏感原文；以结构化摘要为主，必要时仅保留极短截断片段（例如 30–80 字符）。
- **可解释**：优先规则/打分器版本，便于调参和回归测试；后续才引入模型化意图预测。
- **低开销**：窗口为“最近 60 秒/最近 N 条事件”，并带自动过期清理（默认 60s）。

---

## 机制拆分：行为 -> 特征 -> 意图（Intent）

### 1) 行为追踪（BehaviorTracker）

**职责**：记录最近一段时间的用户编辑行为事实（不做推断）。

**典型事件类型**：

- **insert**：输入（键入/IME 提交）
- **delete**：删除（回删/范围删除）
- **paste**：粘贴
- **selection_move**：选区变化（方向键/鼠标点击）
- **undo/redo**：撤销/重做
- **accept_suggestion**：接受补全（Tab）

**建议记录字段（结构化）**：

- `type`: 事件类型
- `ts`: 时间戳
- `from/to`: 文档位置范围（光标/选区）
- `deltaChars`: 字符增量（正=插入，负=删除）
- `contentSample?`: 极短样本（可选，严格截断）
- `source?`: keyboard/mouse/command（可选）

> 说明：对“删除”尤其需要 `deltaChars` + `contentSample`（可选）来区分“改错”与“重写/改结构”。

### 2) 特征提取（FeatureExtractor）

**职责**：把行为窗口压缩成稳定的可预测输入（特征）。

**示例特征**：

- **节奏类**：`typingSpeedCps`、`pauseMsAfterBurst`、`burstCount`
- **分布类**：`opsHistogram`（insert/delete/paste/selection_move 占比）
- **结构类**：`cursorAtEndOfBlock`、`suffixStartsWithDelimiter`（例如 `---` / `##`）、`justTypedListMarker`（`- ` / `* ` / `1. `）
- **质量类**：`recentRejections`（结合 `RejectionTracker`，用于避免重复建议）

### 3) 意图预测（IntentPredictor）

**职责**：输出 `intentKey + confidence + generationPolicy`，用于指导触发与生成。

#### 3.1 规则/打分器（阶段 1，强烈推荐先做）

优点：可解释、稳定、可快速迭代。

常见意图（建议从 5 个开始）：

- **continue_paragraph**：正常续写
- **list_next_item**：继续列点
- **bridge_to_suffix_delimiter**：收束并衔接到后缀分隔符（例如 `---`）
- **rewrite_after_large_delete**：大删后重写（更保守、减少打扰）

#### 3.2 轻量模型/后端分类（阶段 2，可选）

输入：特征 + 少量前后文截断；输出同上。
适用：规则覆盖不足、需要更丰富意图类别时。

---

## “发给 AI 什么” 的建议（最小可用）

我们不建议把完整“行为序列”或“被删全文”直接发给 AI。推荐传递：

- **intentKey**：例如 `rewrite_after_large_delete`
- **confidence**：0–1
- **behaviorSummary**：结构化摘要（例如 `deletedChars=420`, `deleteBurstMs=900`, `afterDeletePauseMs=600`, `suffixDelimiter=true`）

并在后端 prompt 中将其作为额外约束，影响：

- 是否触发（冷却时间）
- 补全长度（更短/更长）
- 输出形态（禁止新标题/分隔符、必须衔接后缀等）

---

## 开发渐进方案与计划（建议）

### 阶段 A：行为追踪基础设施（中优先级）

**目标**：建立可观测、低开销的行为窗口。

**文件变更（建议）**：

1. 新建 `types/behaviorTracking.ts`：类型定义（事件、窗口、摘要）
2. 新建 `services/BehaviorTracker.ts`：单例服务（记录、查询、过期清理）
3. 修改 `Autocomplete.js`：在 ProseMirror `update` 与命令入口集成行为事件上报

**验收标准**：

- 能在控制台或 debug 面板看到最近 60s 的行为统计（不含全文）
- 事件自动过期清理生效（默认 60s）
- 性能无明显回退（高频输入下开销可控）

### 阶段 B：规则版意图预测（高优先级）

**目标**：用少量规则覆盖最重要的场景，立竿见影提升体验。

**实现点（建议）**：

- 新建 `services/IntentPredictor.ts`：基于 FeatureExtractor 的规则输出
- `TriggerManager` 在触发前调用 predictor：
  - `rewrite_after_large_delete` / `structure_editing`：延迟触发或直接不触发
  - `bridge_to_suffix_delimiter`：强制短补全 + 禁止结构输出

**验收标准**：

- 大删/结构调整期间，补全明显减少打扰
- 遇到 `---`/标题等后缀结构时，补全更稳定地“收束并衔接”

### 阶段 C：意图透传到后端（中优先级）

**目标**：把 `intentKey/behaviorSummary` 作为 autocomplete 专属字段透传给后端，进入 prompt 约束。

**实现点（建议）**：

- 扩展前端请求参数（Autocomplete 专属 options）
- 后端 `ConversationOptions`/extender 透传
- `AutocompleteTask.buildFormattedUserMessage()` 附加：
  - `<intent>`/`<behavior>` 标签（结构化，不包含全文）

### 阶段 D：模型化意图预测（低优先级，可选）

**目标**：当规则难以覆盖时，引入轻量分类模型/后端意图服务。

**验收标准**：

- 比规则版更高的命中率或更低的打扰（需数据验证）
- 失败可回退到规则版（可控）

## 拒绝反馈机制

当用户拒绝建议时（继续输入、删除、移动光标等）：
1. 系统检测到文档变化或光标移动，且有活跃建议
2. 将被拒绝的建议记录到 `RejectionTracker`
3. 下次请求时，将最近的拒绝记录发送给 AI
4. AI 会避免生成类似的建议

### 拒绝的判定条件

以下操作会被视为拒绝：
- ✅ **用户继续输入文字**
- ✅ **用户删除文字**
- ✅ **用户粘贴内容**
- ✅ **用户移动光标**（方向键、鼠标点击等）
- ❌ **用户按 Tab 键接受建议**（不算拒绝）

### 拒绝记录详情

- **队列大小**：最多保留 2 条最近的拒绝记录
- **过期时间**：2 分钟后自动清理（见 `AUTOCOMPLETE_CONFIG.rejection.expiryMs`）
- **记录内容**：
  - 被拒绝的建议文本（限 100 字符）
  - 建议显示的位置
  - 拒绝时间戳
  - 用户拒绝后继续输入的文本（限 50 字符）

#### `user then typed` 是怎么收集的？

这里的 `userContinuedWith`（后端 prompt 中展示为 “user then typed”）来自前端对一次拒绝触发的 **ProseMirror 文档变更 diff**：

- **触发时机**：存在活跃建议（Decoration Widget）时，用户发生 `docChanged`（输入/粘贴/替换）或 `selectionPosChanged`（移动光标）会被判定为拒绝。
- **收集内容**：仅提取“本次变更新增的插入文本”（insert/paste/replace 的新增部分），不会再用“光标前 N 个字符”这种会混入上下文的截断方式。
- **不记录的情况**：纯删除、纯光标移动不会写入 `userContinuedWith`（避免误导为 “user then typed”）。

## API 请求参数

```typescript
{
  prompt: '',
  prompt_key: 'autocomplete',
  context_before: string,           // 光标前的上下文
  context_after: string,            // 光标后的上下文
  completion_length_hint: string,   // 补全长度提示
  recent_rejections?: Array<{       // 最近被拒绝的建议
    suggestionText: string,
    userContinuedWith?: string,
  }>,
}
```

## 后端 Prompt 模板

位置：`src/prompts/templates/chat/autocomplete.ts`

主要规则：
1. 仅输出补全文本，无前言、无 markdown
2. 严格匹配用户的写作风格
3. 避免 AI 腔调
4. 遵循 `<completion_length>` 指令
5. 避免重复 `<rejected_suggestions>` 中的建议

## 相关文件

### 前端文件
- **设置 UI**：`apps/renderer/domains/editor/features/DocumentSettings/ui/EditorAiInteractionSettingsSection.vue`
- **设置 Store**：`apps/renderer/shared/stores/aiSettings.js`
- **API 服务**：`apps/renderer/shared/services/aiService/unifiedApiService.js`
- **上下文工具**：`apps/renderer/domains/editor/features/AutoComplete/config/contextConfig.ts`
- **拒绝追踪**：`apps/renderer/domains/editor/features/AutoComplete/services/RejectionTracker.ts`
- **类型定义**：`apps/renderer/domains/editor/features/AutoComplete/types/index.ts`

### 后端文件
- **任务处理器**：`src/features/context-manager/chat/tasks/autocomplete.ts`
- **Prompt 模板**：`src/prompts/templates/chat/autocomplete.ts`
- **请求 Schema**：`src/features/context-manager/chat/schemas.ts`
- **参数透传 Extender**：`src/features/conversation/flow/services/history-builder/extenders/autocomplete-options.extender.ts` 🆕
- **API Schema**：`packages/schemas/src/api-dtos.ts` (ConversationOptions)
- **Agent Schema**：`src/features/context-manager/agent/schemas.ts` (AgentInvokeRequest)

---

## 数据流详解

### 完整请求链路

```
前端 (Autocomplete.js)
    ↓
    收集上下文、补全长度、拒绝记录
    ↓
unifiedApiService.generateText()
    ↓
POST /api/v1/conversation/next
    ↓
ConversationOptions (Zod 验证)
    ✓ completionLengthHint
    ✓ recentRejections
    ↓
HistoryBuilder.buildForAgent()
    ↓
AutocompleteOptionsExtender (透传字段)
    ↓
AgentInvokeRequest
    ✓ completionLengthHint
    ✓ recentRejections
    ↓
AgentMessageOrchestrator.processAgentConversation()
    ↓
AutocompleteSingleTurnAgentTask.buildMessages(AgentInvokeRequest)
    ↓
构建包含 <completion_length> 和 <rejected_suggestions> 的消息
    ↓
AI 模型生成
    ↓
返回补全文本
```

### 关键扩展点

**AutocompleteOptionsExtender** (`autocomplete-options.extender.ts`) 🆕：
- 作用：从 `ConversationNextRequest.options` 提取 autocomplete 专属字段
- 触发条件：`promptKey === 'autocomplete'`
- 透传字段：
  - `completionLengthHint`: 补全长度提示
  - `recentRejections`: 拒绝反馈列表

---

## 📝 AutocompleteTask：自动补全任务

`AutocompleteTask` 是一个轻量级的文本补全任务，用于在用户输入时提供智能续写建议。

### 特性

- **补全长度控制**：支持短（1句话）、中（2-3句话）、长（1段话）三种长度
- **拒绝反馈机制**：记录被拒绝的建议，避免重复推荐
- **简单处理模式**：使用 `useSimpleProcessing = true`，跳过复杂的上下文构建流程

### 文件位置

| 文件 | 说明 |
|------|------|
| `tasks/autocomplete.ts` | 任务处理器实现 |
| `src/prompts/templates/chat/autocomplete.ts` | Prompt 模板 |

### 请求参数

```typescript
interface AutocompleteRequest {
  contextBefore: string;           // 光标前的上下文
  contextAfter: string;            // 光标后的上下文
  currentBlockContent?: string;    // 当前块内容
  completionLengthHint?: string;   // 补全长度提示
  recentRejections?: Array<{       // 最近被拒绝的建议
    suggestionText: string;
    userContinuedWith?: string;
  }>;
}
```

### 补全长度提示

| 长度 | Prompt 提示 |
|------|-------------|
| 短 | `Output exactly 1 short sentence.` |
| 中 | `Output 2-3 sentences.` |
| 长 | `Output a full paragraph.` |

### 用户消息格式

```xml
<completion_length>
Output 2-3 sentences.
</completion_length>

<text_before>
光标前的文本内容...
</text_before>

<cursor_position>
当前块内容...
</cursor_position>

<text_after>
光标后的文本内容...
</text_after>

<rejected_suggestions>
The following suggestions were rejected. Do NOT repeat them or suggest anything similar:
1. "被拒绝的建议1" (user then typed: "用户继续输入的文本")
2. "被拒绝的建议2"
</rejected_suggestions>
```

### Prompt 模板规则

1. **仅输出补全文本**：无前言、无 markdown、无解释
2. **风格模仿**：严格匹配用户的写作风格
3. **避免 AI 腔调**：避免陈词滥调、不必要的引号、生硬的过渡
4. **逻辑流畅**：补全必须逻辑上延续前文并平滑过渡到后文
5. **长度控制**：严格遵循 `<completion_length>` 指令
6. **避免重复**：不输出与 `<rejected_suggestions>` 相似的内容

### 响应处理

`processResponse` 方法会：
1. 移除 `<think>...</think>` 标签及其内容
2. 移除 `reasoning:`、`思考:`、`thought:` 等标记
3. 移除多余的换行符
