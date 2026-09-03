/**
 * @file src/task-queue/workers/graph-indexing.worker.ts
 *
 * @brief 软知识图谱向量索引 Worker（M5: Graph Vectorization）
 *
 * 职责：
 * - 从 workspace.sqlite 读取某个 doc 的图谱产物（nodes/edges）；
 * - 对 nodes(name+description) 与 edges(statement) 生成向量（dense + bm25 sparse）；
 * - 写入 Qdrant 两个集合：kg_nodes_${kbId} / kg_edges_${kbId}；
 * - 维护 doc 级索引状态（knowledge_graph_vector_doc_status）。
 *
 * 重要约束（根因修复）：
 * - 不复用 ingestion 的整条状态机流水线（输入/目标不同），但复用“embed + Qdrant upsert”的技术实现；
 * - 幂等：Qdrant 点 ID 使用“稳定 UUIDv5”（由 node.id/edge.id 派生），重复执行只会覆盖，不会膨胀；
 * - 必须支持取消：文档删除时会尝试 cancel，对应状态应落为 cancelled/failed，避免僵尸状态。
 */

import { parentPort, workerData } from 'worker_threads';

import { modelCatalog } from 'src/domains/model-catalog';
import { enableDiagnosticLogForwarding, Logger } from '../../../shared/logger';
import {
  installRuntimePathRoots,
  type RuntimePathRoots,
} from '../../../shared/runtime-paths';
import {
  installDistributionIdentity,
  type DistributionIdentity,
} from '../../../shared/distribution-identity';

import { getDatabaseService } from '../../../electron-main/services/database';
import { BetterSqliteKnowledgeGraphRepository } from '../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { getGraphEdgesCollectionName, getGraphNodesCollectionName } from '../../../features/knowledge-base/graph/infrastructure/qdrantCollections';
import { QdrantRepositoryImpl } from '../../../features/knowledge-base/infrastructure/QdrantRepositoryImpl';
import { QdrantAdapter } from '../../../infra/adapters/vector-store/index';
import type { QdrantPoint, SparseVector } from '../../../features/knowledge-base/infrastructure/qdrantRepository';
import { textsToSparseVectors } from '../../../features/knowledge-base/ingestion/utils/textToSparseVector';
import { generateGraphVectorPointId } from '../../../shared/utils/idUtils';
import { createEmbeddingPort } from '../../../app-hosts/linnya/adapters/inference';
import type { EmbeddingPort } from '../../../domains/model-inference';

import {
  GraphIndexingJobPayloadSchema,
  validateJobPayload,
  type GraphIndexingJobPayload,
} from '../jobs';

const logger = new Logger('GraphIndexingWorker');

if (parentPort) {
  const diagnosticPort = parentPort;
  enableDiagnosticLogForwarding(envelope => diagnosticPort.postMessage(envelope));
}

let isCancelled = false;

function installWorkerRuntimePathRoots(): void {
  const runtimePathRoots = (
    workerData as { readonly runtimePathRoots?: RuntimePathRoots } | undefined
  )?.runtimePathRoots;
  if (!runtimePathRoots) {
    throw new Error('[GraphIndexingWorker] 缺少 owner 传入的 Runtime path roots');
  }
  installRuntimePathRoots(runtimePathRoots);
}

function installWorkerDistributionIdentity(): DistributionIdentity {
  const distributionIdentity = (
    workerData as { readonly distributionIdentity?: DistributionIdentity } | undefined
  )?.distributionIdentity;
  if (!distributionIdentity) {
    throw new Error('[GraphIndexingWorker] 缺少 owner 传入的 Desktop distribution identity');
  }
  return installDistributionIdentity(distributionIdentity);
}

async function initializeWorkerServices(): Promise<EmbeddingPort> {
  installWorkerRuntimePathRoots();
  await modelCatalog.initialize(installWorkerDistributionIdentity());
  return createEmbeddingPort({ catalog: modelCatalog });
}

function calculateBatchSize(totalTexts: number): number {
  if (totalTexts <= 10) return totalTexts;
  if (totalTexts <= 50) return 5;
  if (totalTexts <= 200) return 10;
  return 20;
}

function buildNodeText(name: string, description: string | null): string {
  const desc = typeof description === 'string' ? description.trim() : '';
  return desc.length > 0 ? `${name}\n${desc}` : name;
}

function buildEdgeText(statement: string | null, fallback: string): string {
  const s = typeof statement === 'string' ? statement.trim() : '';
  if (s.length > 0) return s;

  /**
   * statement 在 schema 中是可选字段（历史抽取/某些 LLM 输出可能缺失）。
   * 这里用“结构化三元组”作为退化文本，保证边仍可被向量检索召回。
   */
  return fallback;
}

type WorkerMessageType = 'progress' | 'completed' | 'failed';
type WorkerOutboundMessage =
  | { type: 'failed'; timestamp: number; error: string }
  | { type: 'progress'; timestamp: number; frontendState: unknown }
  | { type: 'completed'; timestamp: number; result: unknown };

function sendMessage(type: WorkerMessageType, data: unknown): void {
  if (!parentPort) return;
  const timestamp = Date.now();
  const msg: WorkerOutboundMessage =
    type === 'failed'
      ? { type: 'failed', timestamp, error: typeof data === 'string' ? data : String(data) }
      : type === 'completed'
        ? { type: 'completed', timestamp, result: data }
        : { type: 'progress', timestamp, frontendState: data };

  parentPort.postMessage(msg);
}

async function vectorizeAndUpsertPoints(args: {
  embedding: EmbeddingPort;
  embeddingModelId: string;
  qdrantRepository: QdrantRepositoryImpl;
  collectionName: string;
  docId: string;
  docTitle: string;
  blockType: 'kg_node' | 'kg_edge';
  points: Array<{
    id: string;
    blockId: string;
    text: string;
    metadata: Record<string, unknown>;
  }>;
  onProgress: (done: number, total: number) => void;
}): Promise<void> {
  const { embedding, embeddingModelId, qdrantRepository, collectionName, docId, docTitle, blockType, points, onProgress } =
    args;
  if (points.length === 0) return;

  const texts = points.map((p) => p.text);
  const total = texts.length;
  const batchSize = calculateBatchSize(total);

  // 先创建集合（需要向量维度）；因此第一批必须先拿到向量结果
  let createdCollection = false;

  for (let i = 0; i < total; i += batchSize) {
    if (isCancelled) {
      throw new Error('任务已取消');
    }

    const batchEnd = Math.min(i + batchSize, total);
    const batchTexts = texts.slice(i, batchEnd);
    const batchPoints = points.slice(i, batchEnd);

    const embeddingResult = await embedding.embed({ modelId: embeddingModelId, values: batchTexts });
    const denseVectorsRaw = embeddingResult.vectors;

    // 严格收敛：必须是一一对应的 number[][]
    const denseVectors: number[][] = [];
    for (const v of denseVectorsRaw) {
      if (!Array.isArray(v)) {
        throw new Error('嵌入返回格式非法：向量不是数组');
      }
      const vec: number[] = [];
      for (const n of v) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          throw new Error('嵌入返回格式非法：向量元素不是有限数字');
        }
        vec.push(n);
      }
      denseVectors.push(vec);
    }

    if (denseVectors.length !== batchTexts.length) {
      throw new Error(`嵌入返回数量不匹配: expected=${batchTexts.length}, got=${denseVectors.length}`);
    }

    const sparseVectors: SparseVector[] = await textsToSparseVectors(batchTexts);
    if (sparseVectors.length !== batchTexts.length) {
      throw new Error(`稀疏向量返回数量不匹配: expected=${batchTexts.length}, got=${sparseVectors.length}`);
    }

    if (!createdCollection) {
      const vectorDimension = denseVectors[0]?.length ?? 768;
      await qdrantRepository.getOrCreateCollection(collectionName, vectorDimension, 'Cosine', true);
      createdCollection = true;
    }

    const qdrantPoints: QdrantPoint[] = batchPoints.map((p, idx) => {
      const payload = {
        doc_id: docId,
        block_id: p.blockId,
        document: p.text,
        /**
         * ✅ 根因修复：
         * Qdrant 的 payload 解析（toPointPayload）要求 doc_title 为非空字符串。
         * 图谱向量点必须写入可读标题，否则 full 的 kg_nodes/kg_edges 语义检索会因“缺少 doc_title”整体失败并退化为空。
         */
        doc_title: docTitle,
        block_type: blockType,
        metadata: p.metadata,
      };

      return {
        id: p.id,
        vector: {
          default: denseVectors[idx],
          bm25: sparseVectors[idx],
        },
        payload,
      };
    });

    await qdrantRepository.addPoints(collectionName, qdrantPoints);

    const done = batchEnd;
    onProgress(done, total);
  }
}

async function processGraphIndexingJob(): Promise<void> {
  let jobData: GraphIndexingJobPayload;
  try {
    jobData = validateJobPayload(GraphIndexingJobPayloadSchema, workerData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[GraphIndexingWorker] 任务负载验证失败: ${msg}`);
    sendMessage('failed', msg);
    return;
  }

  const { kbId, docId, embeddingModelId } = jobData;
  logger.info(`[GraphIndexingWorker] 开始图谱向量索引: kbId=${kbId}, docId=${docId}, embeddingModelId=${embeddingModelId}`);

  let embedding: EmbeddingPort;
  try {
    embedding = await initializeWorkerServices();
  } catch (error) {
    const msg = `Worker 环境初始化失败: ${error instanceof Error ? error.message : String(error)}`;
    logger.error(`[GraphIndexingWorker] ${msg}`);
    sendMessage('failed', msg);
    return;
  }

  // Worker 线程内需要独立的 DB 连接，只建连接 + 设 pragma，不重跑迁移/插件 lifecycle（F1-02）
  const databaseService = getDatabaseService();
  databaseService.initializeConnectionOnly();
  const graphRepo = new BetterSqliteKnowledgeGraphRepository(databaseService);

  /**
   * ✅ 根因修复：为图谱向量点补齐 doc_title
   *
   * 说明：
   * - 图谱向量点的 doc_id 就是当前索引的 docId（list*BySourceDocId / list*ByEvidenceDocId 的维度一致）；
   * - 标题来源：kb_documents.filename（更贴近用户可见的文档名）。
   */
  const db = databaseService.getDb();
  const docRow = db
    .prepare('SELECT filename FROM kb_documents WHERE id = ? LIMIT 1')
    .get(docId) as { filename: string } | undefined;
  const resolvedDocTitle =
    typeof docRow?.filename === 'string' && docRow.filename.trim().length > 0 ? docRow.filename.trim() : docId;

  const qdrantAdapter = QdrantAdapter.getInstance({ url: 'http://localhost:6333' });
  const qdrantRepository = new QdrantRepositoryImpl(qdrantAdapter);

  try {
    // 读取该 doc 的图谱产物
    const [nodes, edges] = await Promise.all([
      graphRepo.listNodesBySourceDocId(kbId, docId),
      graphRepo.listEdgesByEvidenceDocId(kbId, docId),
    ]);

    const nodePoints = nodes.map((n) => ({
      // 根因修复：Qdrant point id 必须是 UUID/无符号整数；图谱 node.id 可能是普通字符串
      id: generateGraphVectorPointId(kbId, 'kg_node', n.id),
      blockId: typeof n.sourceBlockId === 'string' && n.sourceBlockId.trim().length > 0 ? n.sourceBlockId : n.id,
      text: buildNodeText(n.name, n.description),
      metadata: {
        kb_id: kbId,
        kind: 'kg_node',
        node_id: n.id,
        name: n.name,
        canonical_name: n.canonicalName,
        type: n.type,
        description: n.description,
        source_doc_id: n.sourceDocId,
        source_block_id: n.sourceBlockId,
      },
    }));

    const edgePoints = edges.map((e) => ({
      // 根因修复：Qdrant point id 必须是 UUID/无符号整数；图谱 edge.id 可能是 edge_xxx 这类字符串
      id: generateGraphVectorPointId(kbId, 'kg_edge', e.id),
      blockId: typeof e.evidenceBlockId === 'string' && e.evidenceBlockId.trim().length > 0 ? e.evidenceBlockId : e.id,
      text: buildEdgeText(e.statement, `${e.sourceEntityId} ${e.relationType} ${e.targetEntityId}`),
      metadata: {
        kb_id: kbId,
        kind: 'kg_edge',
        edge_id: e.id,
        source_entity_id: e.sourceEntityId,
        target_entity_id: e.targetEntityId,
        relation_type: e.relationType,
        statement: e.statement,
        confidence: e.confidence,
        sentiment: e.sentiment,
        time: e.time,
        evidence_doc_id: e.evidenceDocId,
        evidence_block_id: e.evidenceBlockId,
      },
    }));

    // 先把 doc 索引状态置为 running（记录本次目标规模）
    await graphRepo.upsertVectorDocStatus({
      kbId,
      docId,
      embeddingModelId,
      nodeCount: nodePoints.length,
      edgeCount: edgePoints.length,
      doneUnits: 0,
      status: 'running',
      errorMessage: null,
    });

    const totalUnits = nodePoints.length + edgePoints.length;
    let doneUnits = 0;

    const report = (deltaDone: number) => {
      doneUnits += deltaDone;
      const progress = totalUnits === 0 ? 1 : Math.min(1, doneUnits / totalUnits);
      sendMessage('progress', { kbId, docId, progress, doneUnits, totalUnits });

      /**
       * ✅ 根因修复：必须把“向量索引进度”落盘，否则 KB 级进度聚合只能看到抽取进度，
       * 会导致“抽取完就显示 100%”的误导。
       *
       * 说明：
       * - 这里按 batch 粒度写库（batchSize 默认为 5~20），写入次数可控；
       * - 使用 void 避免阻塞 embedding 主流程，但必须显式 catch，避免产生未处理的 Promise 拒绝。
       */
      void graphRepo.updateVectorDocProgress(kbId, docId, doneUnits, 'running').catch((e) => {
        logger.warn(
          `[GraphIndexingWorker] 写入向量索引进度失败（将继续运行，仅影响进度显示）: kbId=${kbId}, docId=${docId}, error=${
            e instanceof Error ? e.message : String(e)
          }`
        );
      });
    };

    // 为了不在 vectorizeAndUpsertPoints 内部掺入“全局状态”，
    // 我们对 nodes/edges 分别包一层 prev，用“累积 done -> 增量 delta”的方式统一上报全局进度。

    let prevNodesDone = 0;
    await vectorizeAndUpsertPoints({
      embedding,
      embeddingModelId,
      qdrantRepository,
      collectionName: getGraphNodesCollectionName(kbId),
      docId,
      docTitle: resolvedDocTitle,
      blockType: 'kg_node',
      points: nodePoints,
      onProgress: (done, _total) => {
        const delta = Math.max(0, done - prevNodesDone);
        prevNodesDone = done;
        report(delta);
      },
    });

    let prevEdgesDone = 0;
    await vectorizeAndUpsertPoints({
      embedding,
      embeddingModelId,
      qdrantRepository,
      collectionName: getGraphEdgesCollectionName(kbId),
      docId,
      docTitle: resolvedDocTitle,
      blockType: 'kg_edge',
      points: edgePoints,
      onProgress: (done, _total) => {
        const delta = Math.max(0, done - prevEdgesDone);
        prevEdgesDone = done;
        report(delta);
      },
    });

    if (isCancelled) {
      await graphRepo.upsertVectorDocStatus({
        kbId,
        docId,
        embeddingModelId,
        nodeCount: nodePoints.length,
        edgeCount: edgePoints.length,
        doneUnits,
        status: 'cancelled',
        errorMessage: '任务已取消',
      });
      sendMessage('failed', '任务已取消');
      return;
    }

    await graphRepo.upsertVectorDocStatus({
      kbId,
      docId,
      embeddingModelId,
      nodeCount: nodePoints.length,
      edgeCount: edgePoints.length,
      doneUnits: totalUnits,
      status: 'completed',
      errorMessage: null,
    });

    sendMessage('completed', { kbId, docId, nodeCount: nodePoints.length, edgeCount: edgePoints.length });
    logger.info(`[GraphIndexingWorker] ✅ 图谱向量索引完成: kbId=${kbId}, docId=${docId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[GraphIndexingWorker] ❌ 图谱向量索引失败: kbId=${kbId}, docId=${docId}, error=${msg}`);

    try {
      await graphRepo.upsertVectorDocStatus({
        kbId,
        docId,
        embeddingModelId,
        nodeCount: 0,
        edgeCount: 0,
        doneUnits: 0,
        status: isCancelled ? 'cancelled' : 'failed',
        errorMessage: msg,
      });
    } catch (e) {
      logger.warn(`[GraphIndexingWorker] 写入索引失败状态时出错（将继续上报失败）: ${e instanceof Error ? e.message : String(e)}`);
    }

    sendMessage('failed', msg);
  }
}

// 监听主线程消息（取消）
if (parentPort) {
  parentPort.on('message', (message) => {
    if (message?.cmd === 'cancel') {
      isCancelled = true;
    }
  });
}

export default processGraphIndexingJob;

// 立即执行
void processGraphIndexingJob();
