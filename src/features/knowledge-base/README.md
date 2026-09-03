# Knowledge Base Feature

知识库（Knowledge Base）模块负责管理非结构化文档的摄入、解析、切片、向量化存储以及基于 RAG（Retrieval-Augmented Generation）和 Soft Knowledge Graph（软知识图谱）的检索服务。

## 目录结构

```text
knowledge-base/
├── citations/                              # Knowledge 引用领域能力
│   └── functions/                          # 基于 docId + blockId 生成稳定短 ref
├── document-read/                          # 已知 docId 的原文分块阅读能力
│   ├── definitions/                        # 阅读请求、结果与窄依赖合同
│   ├── functions/                          # 范围裁剪、glance 投影、citation 组装
│   └── orchestration/                      # 授权、SoT 加载与阅读流程
├── domain/                                 # 领域模型
│   ├── block.ts                            # 文档块（Chunk）定义
│   ├── document.ts                         # 文档实体与状态枚举
│   └── knowledgeBase.ts                    # 知识库聚合根
├── application/
│   ├── KnowledgeBaseCoordinator.ts         # 协调器：编排搜索与管理
│   ├── knowledgeBaseService.ts             # 核心服务接口定义
│   ├── searchService.ts                    # ✅ 搜索服务 Barrel（Re-export）
│   ├── search/                             # ✅ 搜索核心模块（拆分自原 searchService）
│   │   ├── defaultSearchService.ts         # 搜索编排实现：RAG + Graph 流程控制
│   │   ├── defaultSearchRanker.ts          # 排序实现：Layered Sorting + RerankingPort
│   │   ├── graphEnhancedAgentSearch.ts     # 软图谱增强组装器（Light/Full 模式输出构建）
│   │   ├── queryVectorBuilder.ts           # Query 向量统一生成（避免重复 Embed）
│   │   ├── documentExistenceFilter.ts      # 孤儿文档过滤器
│   │   └── types.ts                        # 搜索内部类型定义
│   └── services/                           # 业务服务子模块
│       ├── DocumentService.ts              # 文档 CRUD 与状态管理
│       ├── IngestionService.ts             # 摄入任务触发
│       ├── KnowledgeBaseMgmtService.ts     # ✅ KB 元数据/集合级联管理
│       └── TaskService.ts                  # 任务状态查询
├── graph/                                  # ✅ Soft Knowledge Graph 核心引擎
│   ├── application/
│   │   ├── anchor/
│   │   │   └── graphNodeAnchorService.ts   # Entity-Driven Anchor (Full V3)
│   │   ├── connectivity/
│   │   │   └── graphConnectivityService.ts # 孤岛检测与连通性回溯
│   │   ├── merger/
│   │   │   └── graphResultMerger.ts        # Path A/B 结果合并与去重
│   │   ├── traversal/
│   │   │   ├── graphAdjacencyCache.ts      # 邻接查询 TTL 缓存
│   │   │   └── graphMultiHopService.ts     # Multi-hop Beam Search (Full V2)
│   │   ├── entityNormalization.ts          # 实体归一化逻辑
│   │   ├── graphBudget.ts                  # ✅ 图谱预算与模式定义 (GraphBudget)
│   │   ├── graphDiscoveryService.ts        # ✅ Edge-Driven Discovery (Path B)
│   │   ├── graphExtractionService.ts       # 图谱抽取与严格结构投影 (Chunk -> Nodes/Edges)
│   │   ├── graphProgressService.ts         # 进度聚合推送
│   │   ├── graphSearchService.ts           # ✅ Chunk-Driven Search (Path A / Light)
│   │   └── knowledgeGraphQueueOrchestrator.ts # 队列编排与状态回填
│   ├── infrastructure/
│   │   ├── better-sqlite-knowledge-graph.repository.ts
│   │   ├── knowledgeGraphRepository.ts     # 仓储接口
│   │   └── qdrantCollections.ts            # 向量集合命名规范
│   └── __tests__/                          # 图谱模块单测
├── infrastructure/                         # 基础实施层
│   ├── metadataRepository.ts               # 元数据仓储接口
│   ├── originalDocumentRepository.ts       # 原始 PDF 仓储接口（用于 partial 失败页续跑）
│   ├── fileOriginalDocumentRepository.ts   # 文件系统版原始 PDF 仓储
│   ├── qdrantRepository.ts                 # 向量仓储接口
│   ├── sotRepository.ts                    # Source of Truth (原文) 仓储接口
│   ├── QdrantRepositoryImpl.ts             # Qdrant 实现
│   ├── qdrant-repository/                  # Qdrant 内部模块 (Filters, Payload, Schema, SegmentPolicy)
│   └── sqlite/                             # SQLite Schema & Providers
│       ├── knowledge-base.schema.ts
│       ├── knowledge-graph.schema.ts
│       └── schema-providers.ts             # Schema 聚合入口
├── ingestion/                              # 📥 摄入管道
│   ├── stateMachine.ts                     # 摄入状态机
│   ├── IngestionStateMachineManager.ts     # 状态机管理器
│   ├── handlers/                           # 各阶段处理器 (Parsing, Embedding, Storing)
│   ├── orchestration/workerIngestionProgressProjection.ts # Worker 消息到摄取读模型的投影
│   ├── store/ingestionProgressStore.ts      # 摄取进度状态与查询入口
│   └── failureCleanup.ts                   # 失败清理逻辑
├── utils/
│   ├── searchUtils.ts                      # 搜索结果格式化 (Formatter)
│   └── ranking.ts                          # RRF 与智能分层排序纯算法
├── README.md                               # 本文档
└── SOFT_KNOWLEDGE_GRAPH.md                 # 📘 软知识图谱架构与实现细节 (Deep Dive)
```

`document-read` 只拥有 Knowledge 阅读事实和 canonical citation 组装，不依赖 Evidence 存储。Linnya Tool
adapter 在 owner result 通过 strict schema 后负责把 Agent 实际看到的 glance/full 内容投影为
Knowledge 自有 capture DTO；只有 `src/tools/knowledgebase/evidence/knowledgeEvidenceBundleAdapter.ts`
可以再映射为 Evidence write command。这是跨 domain 的 app-level 组合，不应下沉进本 feature。

`shared/agent-observation` 是 Knowledge domain 内搜索与阅读共同使用的模型安全边界：owner 生成的 canonical
ref 和 `doc_id/block_id` 留在可信骨架，标题、摘要、正文及图谱来源文本进入动态不可信边界。边界格式复用
全局稳定的 `shared/ai-observation` 安全原语，但该原语不理解 Knowledge、Evidence 或 Web 业务。

### PDF partial 诊断与失败页续跑

- `Document.parseDiagnostics` 保存 PDF 页级解析事实，当前落库字段是 `parse_diagnostics_json`。
- partial 文档仍保持 `DocumentStatus.COMPLETED`，UI 和续跑逻辑通过 `parseDiagnostics.isPartial` 判断是否存在失败页。
- `Source of Truth` 只保存结构化 `DocumentSoT` JSON，不保存上传原文件；上传临时文件在摄入完成后会被清理。
- `OriginalDocumentRepository` 独立保存原始 PDF，是“继续解析失败页”的前置数据。
- 删除文档 / 删除知识库 / 失败清理必须同步清理原始 PDF，避免磁盘残留。
- 失败页续跑位于 `application/orchestration/continueFailedPdfPages.ts`：
  - 读取原始 PDF 和 `parseDiagnostics.failedPages`。
  - 只解析失败页，只向量化新增 blocks。
  - 增量合并 SoT，新增 Qdrant points，并更新 diagnostics。
  - 不复用全量摄入的 `StoringHandler.cleanupOnFailure`，避免误删已成功页面。

增量提交约束：

- 提交点校验必须检查“本次新增 point ids”，不能只检查 docId 下是否已有点。
- SoT/Qdrant/diagnostics 属于同一次增量提交；任一步失败，都只回滚本次新增 point ids 和 SoT 合并结果。
- 页码单一来源：parser 可输出 `source_info.page_number`，后处理统一归一化到 `source_info.page_num`，Qdrant payload 使用 `page_number` 对外检索。

---

## 跨模块集成文件索引（Cross-Module Integration）

> 说明：知识库 Feature 核心逻辑在 `src/features/knowledge-base/**`，但完整运行依赖主进程与渲染进程配合。

### 1. 数据库 Schema 注册
*   `src/electron-main/services/database.ts`: 注册 `SchemaProvider`。
*   `src/features/knowledge-base/infrastructure/sqlite/schema-providers.ts`: 聚合导出 KB 与 Graph 的 Schema。

### 2. Electron IPC (主进程)
*   **KB 管理**: `src/electron-main/ipc/handlers/knowledge-base/knowledge-base-ipc.ts`
    *   `get-all-kbs`, `create-kb`, `delete-kb`, `update-kb-settings`
*   **项目关联**: `src/electron-main/ipc/handlers/knowledge-base/project-knowledge-base-links-ipc.ts`
*   **图谱进度**: `src/electron-main/ipc/handlers/knowledge-base/knowledge-base-ipc.ts` (集成进度查询与推送)

### 3. Preload & Gateway
*   `src/electron-main/preload/modules/knowledge-base-preload.ts`: 暴露 `window.electronAPI.knowledgeBase`。
*   `apps/renderer/domains/knowledgebase/services/knowledgeBaseService.js`: 前端 Service，优先走 IPC，Web 回退 HTTP。

### 4. 任务队列 (Worker Threads)
*   `src/infra/task-queue/jobs.ts`: 定义 `GraphExtractionJob`, `GraphIndexingJob` Payload。
*   `src/infra/task-queue/workers/graph-extraction.worker.ts`: 图谱抽取 Worker (LLM)。
*   `src/infra/task-queue/workers/graph-indexing.worker.ts`: 图谱向量化 Worker (Embedding -> Qdrant)。
*   `WorkerThreadQueue` 只发布通用 job 生命周期；main 进程组合根仅向 ingestion queue 注入摄取 observer。进度 store 和投影规则始终归本 feature，禁止移回 task-queue 或通过 payload 字段猜测业务类型。

---

## 开发规范 (Developer Norms)

### 0. Agent 阅读边界

- Knowledge 文档阅读的业务入口位于 `document-read` feature；工具层只能负责参数 admission、上下文适配和结果序列化。
- provider 使用 1-based chunk 范围，不复用 Workspace 文件分页或 Web 页面读取合同。
- 项目 scope 必须在读取 SoT 前完成校验；Knowledge feature 通过窄授权函数接收边界规则，不依赖 `ToolContext`。
- `resource_read(kb://...)` 在迁移期只能适配 0-based wrapper，禁止实例化另一个 Tool 共享业务实现。
- 搜索、glance、full 与 deep reading view 都必须使用同一 Knowledge 来源边界；正文内形似 `[@XXXXXX]`
  的字符串没有 citation 身份，Agent 只能引用边界外 owner header 中的 canonical ref。

### 1. 软知识图谱 (Soft Graph)
*   **核心文档**: 详见 [SOFT_KNOWLEDGE_GRAPH.md](./SOFT_KNOWLEDGE_GRAPH.md)。
*   **Ref 语义**: 在 Light/Full 模式下，`ref: in_rag` 的语义为 **“该证据块也在本次工具输出的列表中（可直接阅读）”**，**不再等同于** “RAG TopK”。
*   **Text Generation**: 图谱抽取只依赖 `domains/model-inference` 的 `TextGenerationPort`。Worker composition root 负责构造 Host adapter；抽取服务拥有 prompt、JSON/Zod 校验和图谱规则，不得依赖 `LlmCaller`、`AIEngine` 或 Provider SDK。
*   **Embedding**: 摄入、查询向量、PDF 失败页续跑、Graph Discovery 与 Graph Indexing 只依赖 `domains/model-inference` 的 `EmbeddingPort`。主进程/worker composition root 构造 Host adapter；KB 拥有分批进度、sparse vector、Qdrant 写入、索引 provenance 与重建策略，不得读 Model Catalog 或导入 AI SDK。
*   **Reranking**: 搜索编排只依赖 `domains/model-inference` 的 `RerankingPort`。候选身份以 Provider 返回的 `originalIndex` 为准，禁止按文本反查；只有标记为 retryable 的上游可用性故障可保留已有 RRF/分层排序，配置、凭据、schema、Abort 与编程错误必须继续失败。KB 不读取 Model Catalog，也不导入 AI SDK。

### 2. 类型安全
*   **Strict Typing**: 禁止使用 `any`。Qdrant Payload 取出后必须通过 Zod 或手动校验转换为 Domain Object。
*   **Vector Typing**: Domain port 输出 readonly 向量；只在写入 KB 实体/Qdrant DTO 边界复制为 `number[]`。向量数量、维度与有限值由 Host port 统一校验，业务编排不重复猜测 Provider 响应形状。

### 3. 资源清理
*   **级联删除**: 删除文档/KB 时，必须同步清理：
    1.  SQLite 元数据 (Metadata & Graph Tables)
    2.  Qdrant Collections (Chunks & Graph Nodes/Edges)
    3.  Source of Truth (File System)
    *   参考 `KnowledgeBaseMgmtService.deleteKnowledgeBase` 实现。

### 4. Qdrant 存储策略
*   **Collection 粒度**: 当前 chunk 向量以 `kbId` 作为 collection 名，即“一个知识库对应一个 chunk collection”；图谱向量若启用，则额外使用 `kg_nodes_${kbId}` / `kg_edges_${kbId}`。
*   **固定底座成本**: 小 collection 的磁盘占用往往不是由文档篇数直接决定，而是由 Qdrant 的 segment / WAL / payload page 固定开销决定；因此多个小知识库会比一个大知识库更浪费磁盘。
*   **目标段数规则**: chunk collection 仍然按 `points_count` 推导目标段数：
    1. `0 ~ 20_000 points`：目标 `1` 段
    2. `20_001 ~ 100_000 points`：目标 `2` 段
    3. `100_001 ~ 500_000 points`：目标 `4` 段
    4. `> 500_000 points`：回退到 Qdrant 自动策略（`0`）
*   **创建时一次到位**: chunk collection 在首次创建时就直接带上目标 `default_segment_number`，避免先按 Qdrant 默认多段起步，再在线尝试收敛。
*   **启动后后台重建**: 已存在的历史 chunk collection 会在启动维护阶段检查两类情况，并在后台执行 `scroll(with vector) -> delete -> create -> upsert -> count 校验`，无须用户手工干预：
    1. `segments_count` 明显高于目标值，需要收缩
    2. `points_count` 跨阈值后，当前配置的目标段数已落后于新目标值，需要在下次启动时自动升段重建
*   **并发安全**: 同一个 chunk collection 在后台重建期间，会通过 collection 级访问协调器阻塞该库的搜索 / 上传 / 删除，避免“scroll 漏点”“collection 短暂不存在”或部分结果可见。
*   **图谱范围**: 当前启动收缩只覆盖 chunk collection；`kg_nodes_${kbId}` / `kg_edges_${kbId}` 先保持现状，但创建参数已预留相同扩展入口。

---

## 开发者诊断与维护命令

用于开发/验收阶段的数据重置与调试。

### 1. 重建图谱向量 (推荐)
仅重置 Qdrant 索引与向量状态，**不**重新触发 LLM 抽取（省钱、快）。
```bash
pnpm run kg:reset-vectors -- --kbId <kbId>
```

### 2. 全量重置图谱
清空 SQLite 图谱表与 Qdrant，触发全量 LLM 重新抽取（耗时、耗 Token）。
```bash
pnpm run kg:reset -- --kbId <kbId>
```

### 3. 搜索集成验收 CLI
用于在终端运行真实 Knowledge 搜索链并观察图谱输出；它不是 Agent 工具。搜索命令会初始化当前开发数据库和模型依赖，纯 Qdrant 子命令不会初始化 Workspace。
```bash
# 观察 Full 模式
pnpm run test:knowledge-search -- search --query "..." --graph full

# 查看 Qdrant 状态
pnpm run test:knowledge-search -- qdrant-info
```
*   `qdrant-info` 现会输出 `points_count`、`segments_count` 与 `target_segment_number`，可用于观察动态段数策略是否生效。

维护命令通过 Electron ABI 下的 `better-sqlite3` 参数绑定事务修改 SQLite；不依赖宿主系统的 `sqlite3` CLI，也不拼接外部值。需要删除不兼容的历史 Qdrant collection 时，使用 `kb:delete-vector-collection`，并以同名 `--confirm` 明确确认不可恢复的目标。
