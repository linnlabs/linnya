import type { EmbeddingPort } from '@plugin/backend/inferenceRuntime';
import type {
  QdrantRepository,
  QdrantPoint,
  SparseVector,
} from '../../../infrastructure/qdrantRepository';
import { resolveTargetSegmentCountByPointsCount } from '../../../infrastructure/qdrant-repository/segmentPolicy';
import { textsToSparseVectors } from '../../../ingestion/utils/textToSparseVector';

function calculateBatchSize(totalTexts: number): number {
  if (totalTexts <= 10) return totalTexts;
  if (totalTexts <= 50) return 5;
  if (totalTexts <= 200) return 10;
  return 20;
}

export async function vectorizeAndUpsertGraphPoints(args: {
  embedding: EmbeddingPort;
  embeddingModelId: string;
  expectedSpaceId: string;
  signal?: AbortSignal;
  qdrantRepository: QdrantRepository;
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
  const {
    embedding,
    embeddingModelId,
    qdrantRepository,
    collectionName,
    docId,
    docTitle,
    blockType,
    points,
    onProgress,
  } = args;
  if (points.length === 0) return;

  const texts = points.map(p => p.text);
  const total = texts.length;
  const batchSize = calculateBatchSize(total);

  // 先创建集合（需要向量维度）；因此第一批必须先拿到向量结果
  let createdCollection = false;

  for (let i = 0; i < total; i += batchSize) {
    args.signal?.throwIfAborted();

    const batchEnd = Math.min(i + batchSize, total);
    const batchTexts = texts.slice(i, batchEnd);
    const batchPoints = points.slice(i, batchEnd);

    const embeddingResult = await embedding.embed({
      modelId: embeddingModelId,
      values: batchTexts,
      expectedSpaceId: args.expectedSpaceId,
      signal: args.signal,
    });
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
      throw new Error(
        `嵌入返回数量不匹配: expected=${batchTexts.length}, got=${denseVectors.length}`
      );
    }

    const sparseVectors: SparseVector[] = await textsToSparseVectors(batchTexts);
    if (sparseVectors.length !== batchTexts.length) {
      throw new Error(
        `稀疏向量返回数量不匹配: expected=${batchTexts.length}, got=${sparseVectors.length}`
      );
    }

    if (!createdCollection) {
      const vectorDimension = denseVectors[0].length;
      await qdrantRepository.getOrCreateCollection(collectionName, vectorDimension, 'Cosine', true, {
        // 当前任务可能拆成多批，首次建集合用本次写入总量而不是第一批的大小。
        defaultSegmentNumber: resolveTargetSegmentCountByPointsCount(total),
      });
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
