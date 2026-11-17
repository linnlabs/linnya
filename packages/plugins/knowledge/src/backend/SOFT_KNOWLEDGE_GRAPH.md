# Soft Knowledge Graph Engine: Design & Architecture

## 1. 核心设计理念 (Core Philosophy)

Soft Knowledge Graph（软知识图谱）是 Linnya 独创的知识增强架构，旨在解决传统 RAG 缺乏**多跳推理（Multi-hop Reasoning）**与**隐性关联发现（Serendipity）**的痛点，同时避免硬图谱（如 Neo4j）构建成本高、实体链接（Entity Linking）脆弱的问题。

### 1.1 "Soft" 的定义
*   **Vector-Native (向量原生)**：不追求完美的实体唯一 ID，允许轻微的语义冗余。通过 Embedding 在向量空间进行模糊连接与消歧，容错率远高于传统图谱。
*   **Statement Over Triples (陈述优于三元组)**：不存储僵化的 `(S, P, O)`，而是存储 `(S, Relation_Type, Natural_Language_Statement, O)`。将时间、条件、因果等丰富语义保留在 `statement` 字段中并进行向量化。
*   **Inductive Retrieval (归纳式检索)**：存储时是离散的片段（Chunk + Metadata），检索时动态构建局部子图。
*   **Graph-Augmented Chunks (图增强片段)**：最终交付给 Agent 的不是纯图数据，而是“带有结构化关系导航地图的文本片段”，让 LLM 既能读原文，又能看地图。

---

## 2. 数据模型定义 (Data Schema)

我们采用双层存储架构：**SQLite（权威真值）** + **Qdrant（向量索引）**。

### 2.1 实体节点 (Entity Node)
只存储核心概念，作为图的“锚点”。

```typescript
type EntityNode = {
  id: string;             // canonical_id (e.g., "apple-inc")，由 canonical_name 归一化生成
  name: string;           // 原始实体名 (e.g., "Apple Inc.")
  canonical_name: string; // 规范名 (e.g., "Apple")
  type: string;           // Concept | Org | Person | Loc | Event
  description: string;    // 基于上下文的一句话简介
  vector: number[];       // Embedding(name + description)，存入 Qdrant: kg_nodes_${kbId}
  source_chunks: string[];// 溯源
}
```

### 2.2 关系边 (Relation Edge) - 核心资产
Deep Research 的灵魂。

```typescript
type RelationEdge = {
  id: string;             // 确定性哈希 ID (基于 source|target|relation|doc|block)
  source_entity_id: string;
  target_entity_id: string;
  
  // 1. 宏观类型：用于 Planner 快速剪枝
  relation_type: RelationType; 
  
  // 2. 事实陈述：包含时间、条件、因果的自然语言描述
  // 对此字段进行 Embedding，用于“软连接” (Edge-Driven Search)
  statement: string;      
  statement_vector: number[]; // Embedding(statement)，存入 Qdrant: kg_edges_${kbId}
  
  // 3. 证据溯源 (必须)
  evidence_doc_id: string;
  evidence_block_id: string;
}
```

### 2.3 关系分类体系 (Taxonomy)
限制为以下 6 类，支持 Agent Planner 有效剪枝：
1.  **`IS_A`**: 定义、包含。
2.  **`CAUSES`**: 因果、导致、风险来源。 *(Deep Research 核心)*
3.  **`DEPENDS_ON`**: 依赖、供应商、资金支持。 *(Deep Research 核心)*
4.  **`OPPOSES`**: 竞争、对立。
5.  **`LOCATED_AT`**: 时空关系。
6.  **`RELATED_TO`**: 其他弱关联。
    *   *业务约束*：`RELATED_TO` 在 Multi-hop 扩展中会被**降权**，避免图谱发散成“毛线团”。

---

## 3. 系统工作流 (System Workflow)

### 3.1 写入流程 (Indexing - Asynchronous / Level 2)

结论：用户上传文件后，**Level 1（普通 RAG 切片 + chunk 向量化）**会很快完成；**Level 2（Soft Graph：抽取 + 图谱向量化）**通过后台队列异步构建，不阻塞用户可用性。

#### 3.1.1 队列编排：从“摄入完成”到“图谱就绪”

> 重要：队列本身保持通用（`task-queue`），知识库领域逻辑集中在 `KnowledgeGraphQueueOrchestrator`（高内聚、低耦合）。

- **触发入口**：`ingestion:taskCompleted` 事件
  - 编排器：`src/features/knowledge-base/graph/application/knowledgeGraphQueueOrchestrator.ts`
  - 行为：摄入完成后自动尝试为该 doc 入队图谱抽取（Graph Extraction）
- **抽取完成后串联索引**：`graphExtraction:taskCompleted` 事件
  - 行为：抽取完成后自动入队图谱向量化（Graph Indexing），将 nodes/edges 写入 Qdrant
- **KB 级进度刷新**：
  - `graphExtraction:taskProgress/taskCompleted`
  - `graphIndexing:taskProgress/taskCompleted/taskFailed`
  - 都会触发 `GraphProgressService.onDocProgress(kbId)`，保证进度包含“抽取 + 写向量”的端到端完成定义

#### 3.1.2 抽取 Worker：Graph Extraction（SoT → LLM → SQLite）

文件：`src/infra/task-queue/workers/graph-extraction.worker.ts`

核心目标：从 SoT 文本块（block/chunk）中抽取实体与关系，并写入 SQLite 图谱表。

**关键步骤（与代码事实对齐）**：

1) **前置校验**（避免污染状态）
- 先读 SoT：SoT 不存在则直接失败，不写 `doc_status`（避免“看似开始但其实无数据”）
- 校验文档元数据存在且属于 kb：文档被删除/不属于 kb 则失败退出

2) **互斥与断点续跑（根因级修复）**
- `knowledge_graph_doc_status.done_chunks` 的语义：**已成功完成的 chunk 数**
- 若任务失败会写回 `status=failed` 并保留 `done_chunks`，下次重试从该 offset 继续跑
- 若 SoT 变化导致 chunkCount 变动：从 0 重新开始（避免错位造成漏抽/重抽）

3) **批次抽取（Batch Processing）**
- `chunksPerCall`：每次调用 LLM 处理多少个 chunk（批量抽取，避免单/批两套 prompt 分叉）
- 抽取结果写入：
  - `knowledge_graph_nodes`
  - `knowledge_graph_edges`

4) **两层稳定性保障：重试 + 截断降参（根因级修复）**
- **可恢复瞬时错误重试**：网络抖动/结构抖动有限次重试 + 指数退避
- **同模型重试**：只使用 job payload 中的抽取模型，失败后不切换备用模型，避免同一篇文档混用不同模型
- **截断类错误（finish_reason=length / JSON 数组不完整）特殊处理**：
  - 这是“输出长度约束”问题，**不能**用“同输入原样重试”解决
  - 正确修复是**缩短输出**：
    - 优先把 `chunksPerCall` 逐步减半，且 **offset 不变原地重试**（避免漏抽）
    - 若 `chunksPerCall=1` 仍截断：继续降低 `maxEntitiesPerChunk/maxEdgesPerChunk`（下限为 4/8）
  - 只有 batch 真正成功落库后才推进 `done_chunks` 与 offset

5) **失败回收（避免 running 僵尸锁）**
- Worker 异常时必须将该 doc 的 status 从 `running` 回收为 `failed`
- 否则 backfill 会误判“已经在跑”而永远不再入队

#### 3.1.3 索引 Worker：Graph Indexing（SQLite → Embedding → Qdrant）

文件：`src/infra/task-queue/workers/graph-indexing.worker.ts`

核心目标：把已抽取的 nodes/edges 生成向量并写入 Qdrant，实现 Full 模式的 `kg_nodes/kg_edges` 语义检索。

**关键步骤（与代码事实对齐）**：

1) **读取 SQLite 图谱产物**
- nodes：`name + description` 作为向量化文本（description 空则退化为 name）
- edges：`statement` 作为向量化文本（statement 缺失则退化为 “source relation target”）

2) **幂等写入（防止膨胀）**
- Qdrant point id 使用稳定生成（由 node.id/edge.id 派生），重复运行覆盖而不是新增

3) **payload 强约束（根因级修复）**
- `doc_title` 必须是非空字符串，否则 full 的 kg_nodes/kg_edges 解析会整体失败并退化为空

4) **端到端进度（抽取 + 写向量）**
- 索引开始：写 `knowledge_graph_vector_doc_status(status=running, nodeCount, edgeCount, done_units=0)`
- 每个 batch upsert 后：
  - 发送 progress message（doneUnits/totalUnits）
  - 同时把 `done_units` 落盘（`updateVectorDocProgress`），避免 UI 在“写向量”阶段卡住
- 索引完成：写 `status=completed, done_units=totalUnits`

### 3.2 检索流程 (Search - Hybrid & Graph)

**User Query:** "苹果的供应链正在向哪个国家转移？"

#### 3.2.1 总览：不改变 RAG，只做增强

关键原则：
- **不改变 RAG 的召回与排序**：Soft Graph 只“追加结构化地图/补漏证据块”，不把图谱结果塞回主排序链路
- **No Evidence, No Graph**：无证据不输出（写库时就要求 evidence_doc_id/evidence_block_id）

实现落点（高内聚拆分）：`src/features/knowledge-base/application/search/graphEnhancedAgentSearch.ts`

#### 3.2.2 QueryVector：单一真实来源（性能与一致性）

同一次搜索内，RAG / Discovery / Multi-hop / Entity Anchor 复用同一个 `queryVector`，避免重复嵌入。

#### 3.2.3 Light 模式（Chunk-Driven / 1-hop，不追加新文本）

1) 执行 RAG，得到 TopK 命中 blocks（doc_id + block_id）
2) 对每个命中 block 做图谱反查：`GraphSearchService.getAugmentationsForEvidenceBlocks(refs, enableOneHopExpansion=true, maxEdgesPerEntity=5)`
3) 输出：
- `Graph: Entities` / `Graph: Relations`（受预算裁剪）
- 不追加任何新 block 原文（保持轻量）

**ref 标注语义（必须对齐）**
> 注意：`ref: in_rag` 名字历史遗留，但业务语义是“该边的 evidence block 也在本次工具输出的 blocks 列表中（可直接阅读原文）”，不再等同于 “RAG TopK”。  
- `ref: in_rag`：evidence block 在本次输出里
- `ref: external`：evidence block 不在本次输出里（只给元信息，不拉回原文）

#### 3.2.4 Full 模式（Multi-hop 优先 + Discovery 补漏）

Full 的“discovery 区”包含两类新增 blocks：Multi-hop 结果 + Discovery 结果。

执行顺序（业务策略已写死）：

1) **Path A：Chunk-Driven（与 light 相同）**
- 先拿到 RAG 命中 blocks 的 augmentation（含 1-hop 克制扩展）
- 从 Path A augmentation 抽取 `anchorEntityIds`，作为后续回溯与多跳入口

2) **Full V3：Entity Anchor（不触发 LLM）**
- 用 `queryVector` 在 `kg_nodes_${kbId}` 做语义召回 Top3 实体锚点（Cosine ≥ 0.62）
- 仅作为 Multi-hop 的额外起点（不改变主结果）

3) **Full V2：2-hop Multi-hop（Beam Search v0）优先执行**
- 输入：anchorEntityIds + queryVector
- 参数：maxHops=2、beamWidth=15、minSemanticScore=0.60、hop1MinSemanticMargin=0.02、maxEvidenceBlocksPerDoc=2
- 输出：若干“新增 evidence blocks”，并标记为 `direct_context` + 路径摘要

4) **Path B：Edge-Driven Discovery（Statement Search，补漏）**
- 若预算还有剩余：在 `kg_edges_${kbId}` 做纯语义检索（Cosine ≥ 0.60）
- 仅使用纯语义 score 做阈值（禁止用 hybrid/RRF 分数）

5) **合并去重（避免重复旧闻）**
- `GraphResultMerger` 以 Path A/ Multi-hop 为主，Discovery 结果若与已有 key（kb|doc|block）冲突则丢弃

6) **孤岛检测（Island Detection）**
- 对 Discovery 结果（Path B）做限定 hop 的连通性回溯：
  - 可连通 → `Direct Context` + 路径摘要
  - 不可连通 → `Potential Insight`

---

## 4. 检索模式与参数 (Search Modes & Parameters)

系统通过 **Graph Mode** 控制增强深度，由业务层 (`ToolContext`) 决定。

### 4.1 Mode: Light (Chunk-Driven / Graph-Augmented RAG)
**定位**：稳健、可解释。默认模式。

*   **逻辑**：对 RAG 命中块做 **1-hop** 邻接扩展。
*   **约束**：`max_edges_per_entity=5`, `append_new_chunks=False`。
*   **输出**：仅附加关系信息，不扩大上下文窗口。

### 4.2 Mode: Full (Deep Research / Multi-hop)
**定位**：深挖、发现隐性关联。

*   **逻辑**：
    1.  **Multi-hop**: 2-hop Beam Search (Beam Width=15)。优先执行。
    2.  **Discovery**: 纯语义补漏 (Score > 0.60)。
    3.  **Entity Anchor**: 辅助锚点召回 (Score > 0.62)。
*   **约束**：
    *   **No Evidence, No Graph**: 严禁无证据输出。
    *   **Semantic Margin**: `hop1_min_semantic_margin=0.02` (防漂移)。
    *   **Single Source Throttling**: 单文档证据上限 `2` 块 (强迫多样性)。

---

## 5. 开发者工具 (Developer Tools)

*   **重建向量索引（推荐）**：
    *   `npm run kg:reset-vectors -- --kbId <kbId>`
    *   仅清空 Qdrant 集合与索引状态，保留 SQLite 抽取结果。用于修复 payload 或向量模型变更。
*   **全量重置**：
    *   `npm run kg:reset -- --kbId <kbId>`
    *   清空 SQLite 与 Qdrant，触发重新 LLM 抽取。慎用。
