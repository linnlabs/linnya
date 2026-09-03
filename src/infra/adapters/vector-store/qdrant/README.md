qdrant/
├── index.ts                         # 模块统一出口（barrel）：保持外部 import 路径稳定
├── QdrantAdapter.ts                 # 适配器对外主入口：对外暴露 upsert/search/scroll/collection/delete 等 API
├── types.ts                         # 对外类型定义：QdrantConfig、VectorPoint、SearchParams 等（基础设施层公共契约）
├── guards.ts                        # 类型守卫/安全取值：把 unknown 收敛成可用结构，禁止 any/不安全断言
├── points/
│   └── normalizeUpsertPoints.ts     # upsert 入参归一化：VectorPoint -> Qdrant SDK 需要的命名向量结构
├── search/
│   └── searchPoints.ts              # search 封装：构造检索请求 + 解析返回结果（兼容不同 SDK 返回形态）
├── scroll/
│   └── scrollPointsPage.ts          # scroll 分页读取：解析 points/next_page_offset，统一 nextOffset 语义
├── delete/
│   └── deletePoints.ts              # 删除点：按 ids 或按 filter
└── collections/
    ├── createCollection.ts          # 创建集合：HTTP PUT（支持命名向量 default + 可选稀疏向量）
    ├── updateCollection.ts          # 更新集合：HTTP PATCH
    └── getCollection.ts             # 获取集合信息：收敛成项目所需的最小字段集

---

## 设计说明

### 1) 为什么要按目录拆分

- **高内聚**：同一能力（search/scroll/collections/points/delete）各自收敛在独立文件中，便于定位与演进。
- **低耦合**：业务层只依赖 `QdrantAdapter` + `types.ts`，不需要理解第三方 SDK 的细节。
- **类型安全**：`guards.ts` 作为 “unknown → 可用结构” 的唯一收敛点，避免 any 与散落的断言。

### 2) 对外使用方式

- **推荐**：通过 `QdrantAdapter.getInstance(config)` 获取实例，并调用对应方法。
- **类型**：从本目录 `index.ts` 导出（并被 `src/infra/adapters/vector-store/index.ts` 二次导出）。

### 3) Collection 设计约定

- **命名向量统一**：无论业务层是“单稠密向量”还是“稠密 + 稀疏”，本适配器统一使用命名向量 `default`，并在需要时附加 `sparse_vectors.bm25`。
- **创建与更新分离**：
  - `collections/createCollection.ts`：负责建 collection schema（向量维度、距离度量、稀疏向量开关）
  - `collections/updateCollection.ts`：负责 PATCH collection 运行时配置（如 optimizer / HNSW / quantization）
- **信息查询最小化**：`collections/getCollection.ts` 只收敛项目真正需要的字段，避免向业务层泄漏过多第三方结构。

### 4) 为什么小 collection 也会占很多磁盘

- Qdrant 的 collection 磁盘占用不只是“向量本身”，还包括：
  - segment 固定文件
  - payload page
  - 稀疏向量存储页
  - WAL
- 因此，多个小 collection 往往会出现“points_count 差很多，但目录大小看起来接近”的现象。
- 对本项目这种“一个知识库一个 chunk collection”的模型来说，真正影响小库空间利用率的，往往不是文档篇数，而是 **segment 数量是否过多**。

### 5) collection 收缩策略（Storage Optimization）

- 当前主策略已经不再依赖“上传/删除后在线 PATCH 再等 Qdrant merge”。
- 原因：
  - Windows 上在线 optimizer merge 可能触发 `os error 5`（拒绝访问）
  - 进而导致 `temp_segments` 膨胀，出现“越优化越大”的反效果
- 现行策略分两层：
  - **创建时一次到位**：chunk collection 在创建时直接带上合适的 `optimizers_config.default_segment_number`
  - **启动后后台重建**：若历史 collection 的 `segments_count` 明显高于目标值，或 `points_count` 跨阈值后当前配置目标已落后，则由知识库层执行 `scroll(with vector) -> delete -> create -> upsert -> count 校验`
- 语义说明：
  - `default_segment_number` 仍然表示 **目标段数**
  - 但它现在主要用于“新 collection 的正确初始配置”
  - 历史 collection 的物理收缩由上层重建完成，而不是依赖 Qdrant 在线渐进 merge
- 图谱 collection 当前保持现状；适配器层的创建参数已经预留扩展能力，后续若要对 `kg_nodes_*` / `kg_edges_*` 做同类收缩，不需要再次改 adapter API。

### 6) 基础设施层边界

- `QdrantAdapter` 只负责“请求能力”和“响应收敛”，不直接决定：
  - 一个知识库对应几个 collection
  - 何时触发启动维护
  - 何时重建 collection
- 上述业务语义应由知识库特性层实现，例如：
  - `src/features/knowledge-base/infrastructure/QdrantRepositoryImpl.ts`
  - `src/features/knowledge-base/infrastructure/qdrant-repository/chunkCollectionRecreate.ts`
  - `src/features/knowledge-base/infrastructure/qdrant-repository/startupChunkCollectionMaintenance.ts`
  - `src/features/knowledge-base/infrastructure/qdrant-repository/segmentPolicy.ts`
  - `src/features/knowledge-base/infrastructure/qdrant-repository/collectionAccess.ts`

### 7) 本地进程运行时

`process-runtime/` 把 Backend bootstrap facts 投影成固定 Qdrant 二进制和 child 环境。开发环境只读取 `extraResources`，正式环境只读取发布 `resources`；代理变量在冻结阶段移除并关闭 Qdrant telemetry。进程 owner 不得读取 Electron、`process.resourcesPath` 或运行期 `process.env` 来猜路径和环境。

Qdrant 与 Commands、Profiled Code Sandbox 只复用公共 OS 进程归属，不复用业务授权：macOS 使用 PGID + owner pipe，Windows 使用 Job Object。`createOwnedQdrantProcess()` 只有在 root terminal、tree-empty、平台资源 release 和日志流关闭都完成后才结算；`kill()` 返回或 `ChildProcess.killed` 不属于退出事实。启动失败会先执行同一条有界收口路径，收口失败必须同时保留启动和 cleanup 两类根因。
