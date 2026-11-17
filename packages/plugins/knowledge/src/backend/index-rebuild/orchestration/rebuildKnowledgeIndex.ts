import type { EmbeddingPort, EmbeddingResult } from '@plugin/backend/inferenceRuntime';
import { DocumentSoTSchema } from '../../domain/block';
import { DocumentStatus, type Document } from '../../domain/document';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type {
  PointPayload,
  QdrantPoint,
  QdrantRepository,
} from '../../infrastructure/qdrantRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import { getGraphNodesCollectionName, getGraphEdgesCollectionName } from '../../graph/infrastructure/qdrantCollections';
import { projectGraphVectorPoints } from '../../graph/application/indexing/projectGraphVectorPoints';
import { projectChunkPayload } from '../../ingestion/functions/projectChunkVectorPoints';
import { textsToSparseVectors } from '../../ingestion/utils/textToSparseVector';
import type { KnowledgeIndexIdentity } from '../definitions/knowledgeIndex';

interface IndexPoint { readonly id: string; readonly payload: PointPayload }
interface IndexBatch { readonly collection: string; readonly points: IndexPoint[] }
export interface KnowledgeIndexRebuildDependencies {
  readonly metadata: Pick<
    MetadataRepository,
    'getDocumentsInKnowledgeBase' | 'updateDocumentStatus' | 'indexState'
  >;
  readonly sot: Pick<SotRepository, 'get'>;
  readonly graph: Pick<KnowledgeGraphRepository, 'listNodesBySourceDocId' | 'listEdgesByEvidenceDocId' | 'upsertVectorDocStatus'>;
  readonly vectors: Pick<QdrantRepository, 'collectionExists' | 'deleteCollection' | 'getOrCreateCollection' | 'addPoints' | 'countPointsByIds'>;
  readonly embedding: EmbeddingPort;
}
export interface KnowledgeIndexRebuildProgress {
  readonly completedPoints: number;
  readonly totalPoints: number;
}

/** 每次只读一篇 SoT/图谱产物；验证和真正写入共享同一批次投影，不将全库正文常驻内存。 */
async function* readBatches(deps: KnowledgeIndexRebuildDependencies, kbId: string, documents: Document[], signal: AbortSignal): AsyncGenerator<IndexBatch> {
  const batchSize = 20;
  for (const document of documents) {
    signal.throwIfAborted();
    const raw = await deps.sot.get(document.id);
    // 未解析成功的资料没有 SoT，不凭空生成索引；已完成的资料缺 SoT 则需要先恢复该资料。
    if (!raw && document.status !== 'completed') continue;
    const source = DocumentSoTSchema.parse(raw);
    if (source.doc_id !== document.id) throw new Error(`原文身份不匹配: ${document.filename}`);
    const chunkPoints = Object.entries(source.content_blocks).map(([id, block]) => ({
      id, payload: projectChunkPayload(document.id, document.filename, {
        ...block, id, text: block.text.trim(), level: block.level ?? null, source_info: block.source_info ?? {},
      }),
    }));
    for (let offset = 0; offset < chunkPoints.length; offset += batchSize) {
      yield { collection: kbId, points: chunkPoints.slice(offset, offset + batchSize) };
    }
    const [nodes, edges] = await Promise.all([
      deps.graph.listNodesBySourceDocId(kbId, document.id),
      deps.graph.listEdgesByEvidenceDocId(kbId, document.id),
    ]);
    const { nodePoints, edgePoints } = projectGraphVectorPoints(kbId, nodes, edges);
    for (const group of [
      { points: nodePoints, collection: getGraphNodesCollectionName(kbId), blockType: 'kg_node' },
      { points: edgePoints, collection: getGraphEdgesCollectionName(kbId), blockType: 'kg_edge' },
    ]) {
      for (let offset = 0; offset < group.points.length; offset += batchSize) {
        yield { collection: group.collection, points: group.points.slice(offset, offset + batchSize).map(point => ({
          id: point.id, payload: {
            doc_id: document.id, block_id: point.blockId, document: point.text,
            doc_title: document.filename, block_type: group.blockType, metadata: point.metadata,
          },
        })) };
      }
    }
  }
}

/**
 * 从原文重新派生检索索引；不改原文、文档身份、关联和图谱实体。
 * 调用者必须持有同库独占活动租约。NULL 是持久的不可用标记，只有全部回读成功才能发布身份。
 */
export async function rebuildKnowledgeIndex(args: {
  readonly deps: KnowledgeIndexRebuildDependencies;
  readonly kbId: string;
  readonly modelId: string;
  readonly signal: AbortSignal;
  readonly progress: (value: KnowledgeIndexRebuildProgress) => void;
}): Promise<{ identity: KnowledgeIndexIdentity; points: number }> {
  const { deps, kbId, modelId, signal } = args;
  const documents = await deps.metadata.getDocumentsInKnowledgeBase(kbId);
  let totalPoints = 0;
  for await (const batch of readBatches(deps, kbId, documents, signal)) totalPoints += batch.points.length;
  if (!totalPoints) throw new Error('知识库没有可重建的原文内容');

  const batches = readBatches(deps, kbId, documents, signal);
  const first = await batches.next();
  if (first.done) throw new Error('知识库没有可重建的原文内容');
  // 首批实际请求完成模型/路由/协议/维度验证，结果直接用于写入，不另行试调用。
  const firstEmbedding = await deps.embedding.embed({ modelId, values: first.value.points.map(point => point.payload.document), signal });
  const identity = { modelId, spaceId: firstEmbedding.spaceId };
  const dimension = firstEmbedding.vectors[0]?.length;
  if (!dimension) throw new Error('嵌入模型未返回有效向量');
  function validateEmbedding(batch: IndexBatch, result: EmbeddingResult): void {
    if (result.spaceId !== identity.spaceId || result.vectors.length !== batch.points.length
      || result.vectors.some(vector => vector.length !== dimension)) throw new Error('重建期间嵌入向量身份或维度发生变化');
  }
  validateEmbedding(first.value, firstEmbedding);
  const collections = [kbId, getGraphNodesCollectionName(kbId), getGraphEdgesCollectionName(kbId)];
  const existing: string[] = [];
  for (const collection of collections) {
    signal.throwIfAborted();
    if (await deps.vectors.collectionExists(collection)) existing.push(collection);
  }
  signal.throwIfAborted();
  deps.metadata.indexState.invalidateForRebuild(kbId);
  for (const collection of existing) { signal.throwIfAborted(); await deps.vectors.deleteCollection(collection); }

  let completedPoints = 0;
  const created = new Set<string>();
  async function store(batch: IndexBatch, result: EmbeddingResult): Promise<void> {
    signal.throwIfAborted();
    validateEmbedding(batch, result);
    const sparse = await textsToSparseVectors(batch.points.map(point => point.payload.document));
    if (!created.has(batch.collection)) {
      await deps.vectors.getOrCreateCollection(batch.collection, dimension, 'Cosine', true);
      created.add(batch.collection);
    }
    const points: QdrantPoint[] = batch.points.map((point, index) => ({
      ...point, vector: { default: [...result.vectors[index]], bm25: sparse[index] },
    }));
    signal.throwIfAborted();
    await deps.vectors.addPoints(batch.collection, points);
    const count = await deps.vectors.countPointsByIds(batch.collection, points.map(point => point.id));
    if (count !== points.length) throw new Error(`检索索引回读不完整: ${count}/${points.length}`);
    completedPoints += points.length;
    args.progress({ completedPoints, totalPoints });
  }
  await store(first.value, firstEmbedding);
  for await (const batch of batches) {
    signal.throwIfAborted();
    const result = await deps.embedding.embed({ modelId, values: batch.points.map(point => point.payload.document), expectedSpaceId: identity.spaceId, signal });
    await store(batch, result);
  }
  signal.throwIfAborted();
  // 旧摄入可能在 SoT 落盘后失败。完整向量回读成功才恢复完成状态，解析诊断仍由原文保留。
  for (const document of documents) {
    signal.throwIfAborted();
    if (!await deps.sot.get(document.id)) continue;
    const [nodes, edges] = await Promise.all([
      deps.graph.listNodesBySourceDocId(kbId, document.id),
      deps.graph.listEdgesByEvidenceDocId(kbId, document.id),
    ]);
    await deps.graph.upsertVectorDocStatus({
      kbId,
      docId: document.id,
      embeddingModelId: modelId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      doneUnits: nodes.length + edges.length,
      status: 'completed',
      errorMessage: null,
    });
    if (document.status !== DocumentStatus.COMPLETED) await deps.metadata.updateDocumentStatus(document.id, DocumentStatus.COMPLETED);
  }
  signal.throwIfAborted();
  deps.metadata.indexState.publishRebuilt(kbId, identity);
  return { identity, points: completedPoints };
}
