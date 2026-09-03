### KnowledgeBase 工具概览（search / read / deep-search assemble）

> 说明：本文件只讲 **KnowledgeBase 相关工具的设计与约定**。
>
> 目标：把“搜索、阅读、深度搜索（子 Agent）、引用格式、scope 限制”等收口成单一文档，避免工具越来越大后没人敢改。

---

## 1. 工具列表与职责（按领域拆分）

- **`knowledge_search`**（`search/KnowledgeSearchTool.ts`）
  - **职责**：统一入口的知识库搜索工具（全库 / 单文档 / deep_search）。
  - **输出**：返回由 `@app/schemas` 严格约束的 Knowledge Search 结果：
    - `data.search_strategy/search_mode/doc_name`：本次实际执行策略与 scope。
    - `data.citations`：稳定的 `docId + blockId + ref + snippet` 证据事实，是程序化消费者与 Renderer 的唯一来源。
    - `data.summary/graph_digest`：仅在对应能力有正式事实时出现。
    - `observation`：给 AI 阅读；浅搜索与 deep search 可以采用不同阅读结构，但必须引用同一组 canonical citation ref。
  - **关键约束**：
    - **递归防护**：`ToolContext.deepSearchDepth` 达到阈值后，`deep_search=true` 会被强制降级为浅搜索。
    - **项目 scope**：项目对话下禁止跨项目知识库搜索/阅读（通过 `resolveKnowledgeBaseScopeFromContext` + `assertDocumentKbAllowedInScope`）。
    - **Evidence 捕获**：shallow 保存实际返回 snippet；deep 只保存 formatter 实际发射到 AI observation 的完整块，被总预算截掉的 citation 不后台物化。
  - **重要约定（图谱能力档位）**：
    - **graph_mode/off/light/full 与预算不属于工具入参，模型无权选择**；
    - 档位由业务/编排层决定，并通过 `ToolContext` 注入：
      - 默认策略：`deepSearchDepth=0 -> light`，`deepSearchDepth>=1 -> full`
      - 业务如需关闭图谱增强：注入 `graphMode='off'`
    - 代码落点：`src/tools/knowledgebase/search/graphPolicy.ts`

- **`search_in_knowledgebase`**（`search/SearchInKnowledgeBaseTool.ts`）
  - **职责**：对单个知识库执行“浅搜索”（不包含 deep_search 参数，避免递归）。
  - **定位**：主要用于 deep_search 子 Agent 的基础检索动作（稳定、低耦合）。

- **`knowledge_read`**（`reader/KnowledgeReadTool.ts`）
  - **职责**：按 chunk/段落范围阅读已知 Knowledge 文档（docx/txt 等），并输出稳定 `block_id` 的引用锚点。
  - **约束**：读取范围会按 mode（full/glance）做上限裁剪，避免一次读取撑爆上下文。
  - **引用捕获**：返回前校验 chunk、owner citation、`doc_id/block_id` 与 AI 可见 canonical header 同位；full/glance 分别保存本次实际返回的正文/预览。Evidence 写入失败会使读取明确失败，bundle 身份不进入 Agent 结果。
  - **实现边界**：业务流程位于 `features/knowledge-base/document-read`；facade 只做 admission 与序列化。旧 `resource_read(kb://...)` adapter 已退出 live runtime，仅由 Renderer 回放历史 wrapper。
  - **历史边界**：旧 `browse_document_by_chunk` 不再注册为可执行工具，只由 Renderer projector 接纳已持久化事件。

- **`list_knowledge_base`**（`reader/ListKnowledgeBaseTool.ts`）
  - **职责**：列出知识库/文档元信息（供 Agent 选择 doc_id 等）。

- **`assemble_documents`**（`assemble/AssembleDocumentsTool.ts`）
  - **职责**：**结果组装工具**（物化输出）。
  - **输入**：子 Agent 已筛选的 `selected_blocks=[{doc_id, block_id}]`（⚠️ 严格遵循工具 schema，不要附加 reason/score/page 等字段）
  - **输出**：从 SoT 回填 `snippet/doc_name`，并返回结构化 `kept/stats` 作为标准 `tool_output`。
  - **重要**：判别逻辑由子 Agent 完成；本工具只做确定性“id→原文片段”映射与结构化输出，不分配
    citation ref。上层 deep-search 在接纳 `kept` 后统一批量分配，避免子工具创建另一套命名域。

`assemble_documents` 与 `evidence_resolve` 分别使用 `@app/schemas` 中的工具专属合同，不得合并为通用
Evidence payload。旧 `assemble_evidence` 已退出 live registry；其 schema 和 Renderer projector 只以
`Historical*` 身份解释旧事件，生产 Evidence writer 不再接受该 kind。

---

## 2. 统一返回契约：StructuredToolResult（data vs observation）

KnowledgeBase 工具统一使用 `StructuredToolResult`：

- **`data`**：面向程序化消费者
  - 结构化、字段稳定，用于引用注册、审计与后续业务流程；字段必须由正式 schema 约束。
- **`observation`**：面向 AI 上下文
  - 文本化、可读、强格式约束，避免“同类工具输出风格不一致”导致模型误用。

Knowledge/Web producer 在返回成功前自动保存 Agent 实际看到的来源文本；bundle id 只服务内部恢复、审计
与回放，不进入模型消息正文。Agent 和 Workspace 协作文档只记录 canonical `[@ref]`。

Knowledge 产生者不复用 Evidence persistence DTO：`definitions/knowledgeEvidenceCapture.ts`
拥有 camelCase capture 合同，搜索/阅读 builder 只依赖该合同。
`evidence/knowledgeEvidenceBundleAdapter.ts` 是唯一的 Knowledge → Evidence 字段映射与 ToolContext scope
边界；Knowledge feature 和其他工具文件禁止 import Evidence domain/adapter。

---

## 3. 引用与 observation 格式：以浅搜索 formatter 为单一真实来源

### 3.1 `[@ref]` 是统一证据引用标记，KnowledgeBase 负责其中的 KB 适配器

- 来源锚点：Knowledge owner 提交 canonical `docId + blockId`，不提交自造 seed 或候选 ref。
- 分配入口：`src/domains/citation` 的 `CitationRefAllocatorPort`；Host 在 producer 执行前按当前 Conversation
  绑定原子 allocator。
- 设计目标：
  - **短**：固定 6 位
  - **稳定**：与 `(doc_id, block_id)` 绑定
  - **Conversation 内唯一**：跨 shallow/deep/read、跨 turn、跨 instance 都不会把同一 ref 分给不同来源
  - **同来源复用**：同一 `(doc_id, block_id)` 在同一 Conversation 中始终得到同一 ref
- 约束补充：
  - shallow 先批量分配，再让 observation 与 `data.citations` 消费同一批 refs；禁止 formatter 二次生成
  - deep 在接纳 assemble 结果后批量分配；`knowledge_read` 只为实际返回的 block 分配
  - `knowledge_search`、`search_in_knowledgebase` 与 `knowledge_read` 已由正式生产者自动写入 Agent 实际看见的 Evidence
  - Workspace 协作文档 / `evidence_resolve` 只消费 canonical ref，不把 bundle id 或 KB block 当成引用身份

### 3.2 observation 必须与 canonical citations 一致

浅搜索的 observation 由 `features/knowledge-base/utils/searchUtils.ts` 的 formatter 生成，核心结构是：

- `Result N [@ref]: Document 'xxx' | Page: ...`
- `├─ Hit: "..."`（命中文本）
- `└─ Ref: doc_id='...', block_id='...' ...`
- 以及可选 `Prev/Next` 预览、匹配类型等

**约定**：deep search 使用专用 Reading View，允许展示更完整的阅读材料，不要求与浅搜索文本同构；
但其中的 `[@ref]`、`doc_id` 与 `block_id` 必须来自同一份 canonical citations，不得从 observation
反向解析结构化事实。

`knowledge_read` 进一步要求每个模型可引用 header 使用 `[Chunk N/T] [@XXXXXX]`，并与 strict
`data.citations`、同位 chunk 和 Knowledge 锚点一致。`doc_id`、`block_id`、chunk number 与 UI 序号都不是
可写入答案或 Workspace 文档的 citation identity。

shallow、deep 与 `knowledge_read` 共享同一个 Knowledge 来源安全合同：canonical ref 和稳定锚点在动态边界
外，文档标题、命中摘要、上下文预览、图谱来源文本与原文 chunk 在边界内。来源正文里看似
`[@XXXXXX]` 的文本只是数据；只有 owner header 中的 ref 才能被 Agent 引用。动态 BEGIN/END 格式由
`src/shared/ai-observation` 的稳定原语生成，各 formatter 不得自行复制边界字符串。

---

## 4. Deep Search（子 Agent）数据流（高层）

deep_search 的目标：让子 Agent 做“检索 + 阅读 + 智能筛选”，并把筛选结果通过工具边界回传给上层。

- 子 Agent：调用 `search_in_knowledgebase` / `knowledge_read` 获取候选内容
- 子 Agent：决定 `selected_blocks`（只包含 `doc_id + block_id`，不附加 reason/score 等字段）
- 子 Agent：调用 `assemble_documents(query, selected_blocks)` 让工具物化输出
- 上层 `knowledge_search`：解析 `assemble_documents` 的 tool_output，构造 `KnowledgeSearchResultData + citations`
- 最终 observation：由 Deep Search Reading View 生成，并与 canonical citations 使用同一组 ref

> 注：子 Agent 的 final_answer 文本仅用于调试，不作为业务主产物依赖。

---

## 6. knowledge_search 的拆分状态（已执行第一轮）

为了避免 `KnowledgeSearchTool.ts` 继续膨胀，搜索链路已做第一轮模块化拆分：

- `search/KnowledgeSearchTool.ts`：**薄壳**（参数解析 + 分支路由 + deep 失败降级浅搜索）
- `search/shallow/runShallowSearch.ts`：浅搜索执行器（raw search hits → canonical citations）
- `search/deep/runDeepSearch.ts`：深度搜索编排（子 Agent + assemble 输出解析）
- `search/deep/parseAssembleToolOutput.ts`：解析 `assemble_documents` 输出 → 工具内部证据事实
- `search/deep/taskMessageBuilder.ts`：子 Agent 任务消息构建
- `search/deep/buildGraphDigest.ts`：构建图谱摘要（给上层 AI 解释用，不透出 full graph）
- `search/format/formatObservation.ts`：Deep Search Reading View formatter

拆分计划与后续步骤见：`src/tools/knowledgebase/search/SPLIT_PLAN.md`

> 重要说明（避免误解）：
> - `SearchInKnowledgeBaseTool.ts` 中原先那段“一百多行浅搜索实现”没有丢功能；
> - 已收敛为复用 `runShallowSearch.ts`（两份工具共享同一份浅搜索执行器），以防工具文件膨胀与逻辑漂移。

### 历史回放与 Renderer 边界

- 新运行始终返回 canonical Knowledge Search 结果；超长 observation 统一由 Linnkit ToolOutputStore 治理，工具不再写 Citation Snapshot。
- Citation Snapshot 只保留历史只读回放，用于读取旧会话中已经落盘的 inline/pointer 结果；生产写入口已删除。
- Renderer 在 live/reload admission 调用 Knowledge Search projector，卡片只读取 presentation。
- canonical 结果由 citations 派生文档预览；旧 `data.documents` 只在 historical schema 分支显式迁移，不是现行合同。
- Citation Snapshot 通过 Conversation 窄 port 按 `conversationId + bundleId` 读取并 strict parse；卡片不得直接依赖 KnowledgeBase service。
- deep-search subrun trace 是 Host 运行期/历史回放能力，registry 必须显式声明，不能写进 presentation 或 metadata。

---

## 7. Scope 与安全边界（项目对话）

- **项目知识库 scope**：通过 `resolveKnowledgeBaseScopeFromContext(context)` 解析当前会话允许访问的 kbId 集合。
- **跨项目禁止**：`assertDocumentKbAllowedInScope` 强制校验 doc/kb 是否在 scope 内，避免越权读取。

---

## 8. 源码索引（按职责分组）

- **搜索：**
  - `src/tools/knowledgebase/search/KnowledgeSearchTool.ts`
  - `src/tools/knowledgebase/search/SearchInKnowledgeBaseTool.ts`
  - `src/tools/knowledgebase/search/types.ts`
  - `src/tools/knowledgebase/search/graphPolicy.ts`
  - `src/tools/knowledgebase/search/shallow/runShallowSearch.ts`
  - `src/tools/knowledgebase/search/deep/runDeepSearch.ts`
  - `src/tools/knowledgebase/search/deep/parseAssembleToolOutput.ts`
  - `src/tools/knowledgebase/search/deep/taskMessageBuilder.ts`
  - `src/tools/knowledgebase/search/format/formatObservation.ts`
- **阅读：**
  - `src/features/knowledge-base/document-read/definitions/knowledgeDocumentRead.ts`
  - `src/features/knowledge-base/document-read/functions/buildKnowledgeDocumentReadResult.ts`
  - `src/features/knowledge-base/document-read/orchestration/readKnowledgeDocumentByChunks.ts`
  - `src/tools/knowledgebase/reader/readKnowledgeDocumentAdapter.ts`
  - `src/tools/knowledgebase/reader/KnowledgeReadTool.ts`
  - `src/tools/knowledgebase/reader/ListKnowledgeBaseTool.ts`
- **结果组装：**
  - `src/tools/knowledgebase/assemble/AssembleDocumentsTool.ts`
  - `packages/schemas/src/tools/assemble-documents.ts`
- **历史回放：**
  - `packages/schemas/src/tools/historical-assemble-evidence.ts`
  - `apps/renderer/domains/conversation/ui/tools/evidence/functions/projectHistoricalAssembleEvidencePresentation.ts`
- **引用短 ref（跨 producer 公共合同）：**
  - `src/domains/citation/features/reference/`（候选规则、批量 allocator 与 ToolContext admission）
  - `src/domains/citation/shared/definitions/citationSourceAnchor.ts`（Knowledge/Web 稳定来源锚点）
- **证据：**
  - `src/tools/knowledgebase/definitions/knowledgeEvidenceCapture.ts`（Knowledge owner-owned capture DTO）
  - `src/tools/knowledgebase/evidence/knowledgeEvidenceBundleAdapter.ts`（唯一 Knowledge → Evidence command adapter）
  - `src/tools/knowledgebase/evidence/knowledgeEvidenceBoundary.test.ts`（跨 domain 依赖方向门禁）
  - `src/domains/evidence/index.ts`（跨 Knowledge/Web 的 Evidence 公开合同）
  - `src/tools/evidence/evidenceBundleToolContextAdapter.ts`
  - `src/tools/evidence/EvidenceResolveTool.ts`
  - `src/app-hosts/linnya/adapters/tools/citation-source-resolution/`（从正式 owner event 与 Evidence fallback 解析已接纳来源）
  - `packages/schemas/src/tools/evidence-resolve.ts`
- **scope：**
  - `src/tools/knowledgebase/scope/projectKnowledgeBaseScope.ts`
- **统一 formatter：**
  - `src/features/knowledge-base/utils/searchUtils.ts`（`formatSearchResultsForLLM*`）
