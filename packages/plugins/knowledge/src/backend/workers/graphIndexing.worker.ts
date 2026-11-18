import { vectorizeAndUpsertGraphPoints } from '../graph/application/indexing/vectorizeAndUpsertGraphPoints';
import { projectGraphVectorPoints } from '../graph/application/indexing/projectGraphVectorPoints';
import { KnowledgeIndexStateRepository } from '../index-rebuild/persistence/KnowledgeIndexStateRepository';
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
import { createPluginWorkerInferencePort } from '@plugin/backend/worker/inferenceRuntime';

import { Logger } from '@plugin/backend/worker/loggingRuntime';
import { openPluginWorkerDatabase } from '@plugin/backend/worker/databaseRuntime';

import { BetterSqliteKnowledgeGraphRepository } from '../graph/infrastructure/better-sqlite-knowledge-graph.repository';
import {
  getGraphEdgesCollectionName,
  getGraphNodesCollectionName,
} from '../graph/infrastructure/qdrantCollections';
import { QdrantRepositoryImpl } from '../infrastructure/QdrantRepositoryImpl';
import { QdrantAdapter } from '../infrastructure/vector-store';

import {
  GraphIndexingJobPayloadSchema,
  validateJobPayload,
  type GraphIndexingJobPayload,
} from '../queue/definitions/jobs';

GraphIndexingJobPayloadSchema.parse(workerData);
const database = openPluginWorkerDatabase();

const logger = new Logger('GraphIndexingWorker');

let isCancelled = false;
const cancellation = new AbortController();
const inference = createPluginWorkerInferencePort();

function initializeWorkerServices(): void {
  // 迁移与准入由 Host 已完成；Worker 只打开同工作区的窄连接。
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
  logger.info(
    `[GraphIndexingWorker] 开始图谱向量索引: kbId=${kbId}, docId=${docId}, embeddingModelId=${embeddingModelId}`
  );

  try {
    initializeWorkerServices();
  } catch (error) {
    const msg = `Worker 环境初始化失败: ${error instanceof Error ? error.message : String(error)}`;
    logger.error(`[GraphIndexingWorker] ${msg}`);
    sendMessage('failed', msg);
    return;
  }

  // Worker 线程内需要独立的 DB 连接，只建连接 + 设 pragma，不重跑迁移/插件 lifecycle（F1-02）

  const graphRepo = new BetterSqliteKnowledgeGraphRepository(database);

  /**
   * ✅ 根因修复：为图谱向量点补齐 doc_title
   *
   * 说明：
   * - 图谱向量点的 doc_id 就是当前索引的 docId（list*BySourceDocId / list*ByEvidenceDocId 的维度一致）；
   * - 标题来源：kb_documents.filename（更贴近用户可见的文档名）。
   */
  const db = database;
  const docRow = db.prepare('SELECT filename FROM kb_documents WHERE id = ? LIMIT 1').get(docId) as
    | { filename: string }
    | undefined;
  const resolvedDocTitle =
    typeof docRow?.filename === 'string' && docRow.filename.trim().length > 0
      ? docRow.filename.trim()
      : docId;

  const qdrantAdapter = QdrantAdapter.getInstance({
    url: requireVectorEndpoint(jobData.runtime.qdrantUrl),
  });
  const qdrantRepository = new QdrantRepositoryImpl(async () => qdrantAdapter);

  try {
    const identity = new KnowledgeIndexStateRepository(database).requireReady(kbId);
    // 读取该 doc 的图谱产物
    const [nodes, edges] = await Promise.all([
      graphRepo.listNodesBySourceDocId(kbId, docId),
      graphRepo.listEdgesByEvidenceDocId(kbId, docId),
    ]);

    const { nodePoints, edgePoints } = projectGraphVectorPoints(kbId, nodes, edges);
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
      void graphRepo.updateVectorDocProgress(kbId, docId, doneUnits, 'running').catch(e => {
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
    await vectorizeAndUpsertGraphPoints({
      embedding: inference.embedding,
      embeddingModelId,
      expectedSpaceId: identity.spaceId,
      signal: cancellation.signal,
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
    await vectorizeAndUpsertGraphPoints({
      embedding: inference.embedding,
      embeddingModelId,
      expectedSpaceId: identity.spaceId,
      signal: cancellation.signal,
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

    sendMessage('completed', {
      kbId,
      docId,
      nodeCount: nodePoints.length,
      edgeCount: edgePoints.length,
    });
    logger.info(`[GraphIndexingWorker] ✅ 图谱向量索引完成: kbId=${kbId}, docId=${docId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      `[GraphIndexingWorker] ❌ 图谱向量索引失败: kbId=${kbId}, docId=${docId}, error=${msg}`
    );

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
      logger.warn(
        `[GraphIndexingWorker] 写入索引失败状态时出错（将继续上报失败）: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    sendMessage('failed', msg);
  }
}

// 监听主线程消息（取消）
if (parentPort) {
  parentPort.on('message', message => {
    if (message?.cmd === 'cancel') {
      isCancelled = true;
      cancellation.abort();
    }
  });
}

export default processGraphIndexingJob;

// 立即执行
void processGraphIndexingJob().finally(() => {
  inference.dispose();
  database.close();
  parentPort?.close();
});

function requireVectorEndpoint(endpoint: string | undefined): string {
  if (!endpoint) throw new Error('向量任务缺少已就绪的受管 endpoint');
  return endpoint;
}
