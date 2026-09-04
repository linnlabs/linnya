# Review（审阅）模块说明

本模块用于“审阅当前文档”的侧边栏能力：选择审阅角色、配置审阅背景/目标、展示审阅结果，并将审阅结果以“批注（Annotation）”的形式落到文档块上，支持定位与删除。

入口约定：Review 属于 editor 文档工具，只能在当前打开 Markdown/editor 文档时由 AppHeader 的文档 pane 入口打开；不要把 Review 挂回对话 pane 工具组。

## 模块职责

- **审阅配置**：选择系统/自定义审阅角色（最多 3 个），填写审阅背景与目标。
- **审阅流程**：发起审阅、展示进度、展示结果（顺序执行：角色 × 分段 chunk）。
- **结果联动批注**：审阅过程中由后端工具把批注写入 Markdown 文档的新版本；前端结果页展示批注并支持定位/删除。
- **结果筛选**：顶部 Tab 按“已选择的审阅角色”分组（`全部 + 角色`），而不是按标签（category）分组。

## AI 调用入口与 Prompt Key（重要）

- **调用入口**：统一使用 `POST /api/v1/conversation/next`（你们的“简单链路”同样走该端点）
  - 参考：`apps/renderer/shared/services/aiService/unifiedApiService.js`
- **不传历史**：简单链路通过 `options.persist=false` + 不传/传空 `options.conversationHistory` 来实现
- **Review Prompt Key**：`REVIEW: 'review'`（已在后端注册，见 `src/prompts/types.ts`）

## 审阅角色（系统角色 + 自定义角色）

前端内置 3 个系统角色，并允许用户创建自定义角色：
- **系统角色**：见 `store/reviewStore.ts` 的 `availableAgents`（`logicCheck / structure / polish`）
- **自定义角色**：见 `ui/views/ReviewAgentCreator.vue`（用户填写 `systemPrompt` 和 `knowledge`）

当前实现约定：
- 后端新增通用 `agents` 表持久化自定义角色（默认且只能创建为全局，跨项目复用）
- 每次审阅调用都按所选角色逐个运行，并把 `agent_*` 字段注入提示词

角色提示词加载规则（实现约束）：
- **系统内置角色**：后端按 `agent_id` 加载“产品内置 system prompt”（每个角色单独一份）
- **用户自定义角色**：后端从 `agents.system_prompt / agents.knowledge` 加载，并注入到 review prompt 模板变量（前端不在请求里传 prompt，避免漂移/不可复现）

## Review AI 调用模式（重要）

Review 必须走 Agent 模式（`options.mode='agent'`），因为：
- Chat 模式在后端会强制禁用工具（`enableTools=false`，`availableTools=undefined`）
- Review 需要模型调用“创建批注”工具修改文档

## 为什么 Review 需要 review_run_id（与侧边栏对话不同）

`document_fragment` 里包含 `[#ref]` 的目的，是让模型能“指向具体块”。但 **文档内批注需要的是目标 root block 的稳定 ID**（文档里没有 ref 字段）。

- **review_run_id**：
  - 不是给模型用的，而是落在 annotation `meta.reviewRunId`，用于“一次审阅”分组
  - 支持后续能力：批量回滚/删除本次审阅结果、幂等去重（避免重复写入批注）

对比：侧边栏对话（`apps/renderer/domains/conversation/services/orchestration/context/contextConfig.ts`）只需要“读上下文并回答”，不需要创建批注，因此不需要 review_run_id。

## “工具自己读文档”到底是什么意思（避免误解）

这里的“读文档”**不是给模型一个“阅读工具”**，也不是 AI 主动调用某个读取工具。

含义是：当模型调用 `markdown_create_annotations` 时，**后端执行 Markdown domain 的专属工具**。工具读取正式文档，以 annotations feature 的确定性 ref 规则把 `target_ref` 反解成目标 block ID，把批注附加到对应 root block，并一次性创建一个新文档版本。写入前必须验证 fragment 携带的 `document_version` 仍等于数据库最新版本。

也就是说：
- 模型可见：只有前端注入的 `document_fragment`（带 `[#ref]`）+ “创建批注”工具本身
- 模型提交：`target_ref`（ref），不提交 `blockId`
- 后端工具内部：校验 expected version → 展平 blocks → `ref -> blockId` → 更新 root block attrs → 创建文档版本

## 后端/AI 基础设施（已落地 ✅）

后端核心基础设施已全部实现：

1. **PromptKey & 模板**：
   - Key: `PromptKeys.REVIEW = 'review'`
   - Template: `src/prompts/templates/agent/review.ts`（Agent 模式，明确要求调用工具）
   - Builtin Agents: `src/prompts/templates/agent/review.builtinAgents.ts`

2. **工具（Tool）**：
   - Name: `markdown_create_annotations`
   - File: `src/domains/markdown/tools/create-annotations/MarkdownCreateAnnotationsTool.ts`
   - Config: 已迁移到后端 `AgentRegistry`（`src/features/agent-registry/agents/review/index.ts`），确保 Review 任务只能调用此工具。

3. **数据持久化（Agents 表）**：
   - Schema: `src/features/workspace/infrastructure/sqlite/schemas/agents.schema.ts`
   - Service: `src/features/workspace/infrastructure/sqlite/services/agents.service.ts`
   - IPC: `workspace:list-agents` / `workspace:create-agent` 等已注册。

4. **端到端流程**：
   - 前端发起 `mode='agent', promptKey='review'` 请求（分段多次调用） →
   - 后端 `FlowOrchestrator` 识别 Agent 模式 →
   - 自动加载 `availableTools=['markdown_create_annotations']` →
   - 模型执行并 tool_call 创建批注 →
   - `MarkdownCreateAnnotationsTool` 创建包含批注的新文档版本 →
   - 前端读取最新版本，只把新增批注合并进当前 editor transaction。

## 前端实现现状

> 本节描述的是**当前代码真实实现**，用于后续维护时快速定位。

### 总体数据流（前端）

- `ReviewSetup.vue` 点击“开始审阅” →
- `reviewStore.startReview()`：
  - 进入 `processing` 状态
  - 生成 `currentReviewRunId`
  - 向 window 派发事件：**`review-started`**
- `ReviewSidebar.vue` 监听 **`review-started`**：
  - 从 `useUIStore().getEditor()` 获取**当前编辑器实例**（所见即所得）
  - 审阅开始前强制保存当前文档，确保后端读取到同一份正式版本
  - 通过 `reviewDocumentChunker.ts` 从 editor 导出全文 `document_fragment`，按块分段（chunk）
  - 以 **Agent 模式**顺序执行：角色 × chunk
    - 入口：`generateTextStream(...)` → `POST /api/v1/conversation/next`
    - 必须：`mode='agent'` + `prompt_key='review'` + `enableTools=true`
    - 每段都携带：
      - `document_fragment`（DocumentView 协议，包含 document_id、当前 document_version 与 `[#ref]`）
      - `review_run_id / agent_id / chunk_index / total_chunks / review_background / review_goal`
  - 每段结束后读取最新文档版本，并通过 `annotationStore.mergeAnnotationsFromDocumentJson(...)` 只合并新增批注，不覆盖审阅期间的本地正文编辑
  - 下一段使用刚读取到的版本号；若审阅期间其他流程先创建了版本，工具整批拒绝本次写入
  - 全部完成后切换到 `results`
- `ReviewDashboard.vue` 渲染结果：
  - **结果数据源**：`annotationStore.annotations`
  - 过滤：`annotation.meta.source === 'review'`
  - Tab 过滤：按 `annotation.meta.agentId`
  - 删除：调用 `annotationStore.removeAnnotation(annotationId)`，通过 ProseMirror transaction 修改文档内批注
  - 定位：派发 `locate-annotation` 事件（携带 `annotationId`）

### 注意

- **禁止回退到 mock**：Review 不再生成 `reviewMessages`，也不再通过前端调用 `startCreatingAnnotation/confirmCreatingAnnotation` 来“模拟落库”。
- **工具调用前提**：Review 必须 `mode='agent'`，否则后端会禁用工具调用，批注无法落库。
- **document_id 与 expected version 不由模型填写**：前端在 `document_fragment` 头部携带正式身份与版本，后端解析后注入工具上下文；模型创建批注时只需要提交 `annotations_markdown`（多行 `[#ref] 批注内容`）。
- **批注 author 不再由模型传入**：后端会把当前审阅角色名注入到工具上下文，工具落库时统一写入批注 author，避免模型乱填导致不可控。
- **批注位置为何不进入文档**：`position` 是纯视图状态，由前端根据当前 DOM 计算；Markdown 文档只保存批注身份、内容、状态、回复和业务元信息。

## 目录结构（文档树）

```text
apps/renderer/domains/editor/features/Review/ (Frontend)
├── index.ts
├── README.md
├── config/
│   └── contextConfig.ts                  # Review 分段配置（按块分段）
├── services/
│   └── reviewAgentsService.ts            # 自定义角色 agents IPC 访问层
├── store/
│   └── reviewStore.ts
├── types/
│   └── reviewAnnotation.ts               # Review 结果类型（来自 annotations）
├── ui/
│   ├── ReviewSidebar.vue
│   ├── components/
│   │   └── ReviewMessageCard.vue
│   └── views/
│       ├── ReviewSetup.vue
│       ├── ReviewAgentCreator.vue
│       ├── ReviewProcessing.vue
│       └── ReviewDashboard.vue
└── utils/
    └── reviewDocumentChunker.ts          # 从 editor 导出 DocumentView 并按块分段

src/ (Backend Implementation)
├── prompts/
│   ├── types.ts                          # 注册 PromptKeys.REVIEW
│   └── templates/agent/
│       ├── review.ts                     # Review Agent 模板 (PromptType.AGENT)
│       └── review.builtinAgents.ts       # 系统内置角色提示词 (logicCheck/structure/polish)
├── domains/markdown/
│   ├── tools/create-annotations/MarkdownCreateAnnotationsTool.ts # Review 专属工具协议入口
│   └── features/annotations/                                    # ref 解析、目标校验与文档内批注写入
├── features
│   ├── workspace/infrastructure/sqlite/
│   │   ├── schemas/agents.schema.ts          # Agents 表结构 (id, name, system_prompt...)
│   │   └── services/agents.service.ts        # Agents CRUD 服务
│   ├── review/
│   │   └── enrichment/review.enricher.ts        # 增强上下文：注入 document_id/review_run_id/agent_name 等
│   └── conversation/flow/services/history-builder/extenders/review-options.extender.ts # Review 请求字段透传：从 ConversationNextRequest.options 提取 Review 扩展字段
│
└── electron-main/ipc/handlers/workspace/
    └── agents-ipc.ts                     # Agents IPC (create/list/update/delete)
```

## 入口与导出

- **导出入口**：`index.ts`
  - `export * from './store/reviewStore'`
  - `export { default as ReviewSidebar } from './ui/ReviewSidebar.vue'`

## 核心状态（Pinia Store）

文件：`store/reviewStore.ts`

- **审阅流程状态**：`status`（`idle | creating_agent | processing | results`）
- **角色数据**：
  - `availableAgents`：系统角色 + 用户自定义角色
  - `activeAgentIds`：当前选中的角色 id（最多 3 个）
  - `selectedAgents`（getter）：根据 `activeAgentIds` 取回完整角色对象
- **审阅输入**：`reviewBackground` / `reviewGoal`
- **审阅运行标识**：`currentReviewRunId`（用于后端写入 annotation.meta.reviewRunId，便于分组/回滚）
- **结果筛选（按角色）**：
  - `activeAgentFilter`：`'all' | string`
  - 说明：筛选发生在 `ReviewDashboard.vue`（基于 `annotationStore.annotations`），store 不再维护 `filteredMessages`

Review 列表完全来自当前编辑器文档中的批注。

## 视图与组件关系

### ReviewSidebar（容器/路由）

文件：`ui/ReviewSidebar.vue`

- 通过 `reviewStore.status` 在 4 个视图间切换：
  - `ReviewSetup`：配置页（角色 + 背景/目标）
  - `ReviewAgentCreator`：创建/编辑自定义角色
  - `ReviewProcessing`：审阅进行中
  - `ReviewDashboard`：结果页
- 监听全局事件 **`review-started`**：
  - 从 `useUIStore().getEditor()` 获取编辑器实例（所见即所得）
  - 审阅开始前保存文档
  - 通过 `reviewDocumentChunker.ts` 分段导出 `document_fragment`
  - 顺序调用 `generateTextStream`（Agent 模式）触发后端工具创建文档版本
  - 每段结束后读取最新文档，只合并新增批注

### ReviewDashboard（结果页）

文件：`ui/views/ReviewDashboard.vue`

- 顶部 Tabs：`全部 + selectedAgents`（按角色筛选）
- 结果列表：使用 `ReviewMessageCard` 展示 Review 批注（`meta.source === 'review'`）
- 支持从结果卡片触发定位：向 window 派发 **`locate-annotation`** 事件（携带 `annotationId`）
- 删除：调用 `annotationStore.removeAnnotation(annotationId)`

### ReviewMessageCard（结果卡片）

文件：`ui/components/ReviewMessageCard.vue`

- 右上角操作（hover 显示）：定位（可选）、关闭（删除消息）
- hover 只做阴影变化（避免边框导致的视觉跳动），并通过列表容器 padding 保证阴影不被截断

## 与 Annotation 的联动（批注创建）

Review 批注由后端工具批量附加到目标 root block；前端读取最新文档版本后，只合并本地尚未出现的批注。定位、编辑和删除都继续走 Annotation feature 的文档 transaction。

## 常见修改点（给维护者）

- **修改顶部 Tab 逻辑**：优先调整 `reviewStore.activeAgentFilter` 与 `ReviewDashboard.vue` 的筛选逻辑（基于 `annotation.meta.agentId`）。
- **新增/调整角色能力**：
  - 系统角色：改 `reviewStore.availableAgents` 的内置列表
  - 自定义角色：改 `reviewAgentsService.ts`（agents IPC）与 `ReviewAgentCreator.vue`
- **调整分段策略**：改 `config/contextConfig.ts`（例如 `maxBlocksPerChunk`）
- **调整调用/并发策略**：改 `ReviewSidebar.vue` 的执行循环；当前严格顺序用于保证每次工具调用都基于上一版文档继续写入
