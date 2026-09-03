/**
 * @file graphDiscoveryService.ts
 *
 * @description
 * 软知识图谱的“补漏召回”（Discovery）服务。
 *
 * 背景：
 * - 仅把 evidence block 里的 entities/edges “贴回去”（Chunk-Driven augmentation）对强模型的增益有限；
 * - 软图谱真正的价值是：从图谱（尤其是 statement 向量索引）召回 **RAG 没召回到的新证据块**，
 *   产生信息增量（Discovery / Serendipity）。
 *
 * 重要约束（保持 Soft）：
 * - 这里不做“硬规则推理/硬图谱遍历”，只做向量召回 + 证据回溯；
 * - 必须能指回证据：返回结果以 (docId, blockId) 为主，后续由上层决定是否读取原文。
 */
import type { QdrantRepository } from '../../infrastructure/qdrantRepository';
import type { EmbeddingPort } from 'src/domains/model-inference';
import { getGraphEdgesCollectionName } from '../infrastructure/qdrantCollections';

export type GraphDiscoveredEvidenceBlock = {
  docId: string;
  blockId: string;
  /**
   * 来自向量检索的分数（语义/混合）。用于上层做排序或调试展示。
   */
  score: number;
};

export class GraphDiscoveryService {
  private readonly qdrantRepository: QdrantRepository;
  private readonly embedding: EmbeddingPort;

  constructor(qdrantRepository: QdrantRepository, embedding: EmbeddingPort) {
    this.qdrantRepository = qdrantRepository;
    this.embedding = embedding;
  }

  async discoverEvidenceBlocksByQuery(args: {
    kbId: string;
    query: string;
    embeddingModelId: string;
    /**
     * 可选：由上层提前计算的 query 向量（用于复用，避免重复 embed）。
     */
    queryVector?: number[];
    /**
     * 额外从图谱边向量索引中检索的 topK（注意：这是“边”数量，不等于最终返回的 block 数）
     */
    topKEdges: number;
    /**
     * 最多返回的“新证据块”数量
     */
    maxBlocks: number;
    /**
     * 排除集合，key 约定为 `${docId}|${blockId}`
     */
    excludeKeys: ReadonlySet<string>;
    /**
     * 最小语义相似度阈值（Cosine Similarity）。
     *
     * 重要：必须是“纯语义检索”的 score（Qdrant semantic search），禁止使用 RRF/hybrid 分数。
     */
    minSemanticScore: number;
  }): Promise<GraphDiscoveredEvidenceBlock[]> {
    const { kbId, query, embeddingModelId, queryVector: queryVectorFromCaller, topKEdges, maxBlocks, excludeKeys, minSemanticScore } = args;
    if (maxBlocks <= 0) return [];
    if (topKEdges <= 0) return [];
    if (kbId.trim().length === 0 || query.trim().length === 0 || embeddingModelId.trim().length === 0) return [];
    if (typeof minSemanticScore !== 'number' || !Number.isFinite(minSemanticScore) || minSemanticScore < 0 || minSemanticScore > 1) {
      throw new Error('图谱补漏召回失败：minSemanticScore 必须是 [0, 1] 区间内的有限数字');
    }

    const queryVector: number[] = [];
    if (Array.isArray(queryVectorFromCaller) && queryVectorFromCaller.length > 0) {
      for (const n of queryVectorFromCaller) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          throw new Error('图谱补漏召回失败：queryVector 返回格式非法（元素不是有限数字）');
        }
        queryVector.push(n);
      }
    } else {
      const result = await this.embedding.embed({ modelId: embeddingModelId, values: [query] });
      const embedding = result.vectors[0];

      // 这里不做“防御性容错”，严格要求 embedding 是 number[]
      if (!Array.isArray(embedding)) {
        throw new Error('图谱补漏召回失败：query embedding 返回格式非法（不是数组）');
      }
      for (const n of embedding) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          throw new Error('图谱补漏召回失败：query embedding 返回格式非法（元素不是有限数字）');
        }
        queryVector.push(n);
      }
    }

    const collectionName = getGraphEdgesCollectionName(kbId);
    // ✅ Path B：Pure Semantic Search（Cosine Similarity）
    // 说明：
    // - Deep Research 的补漏召回需要“语义跨越”，不能让 BM25/RRF 把结果压低；
    // - 因此这里使用 semanticSearch + score_threshold 作为硬门槛，保证结果“宁缺毋滥”。
    const points = await this.qdrantRepository.semanticSearch(
      collectionName,
      queryVector,
      topKEdges,
      { blockTypes: ['kg_edge'] },
      minSemanticScore
    );

    // 由边的 evidence_block_id 回溯到“证据块”（该字段在索引时写入 payload.block_id）
    const out: GraphDiscoveredEvidenceBlock[] = [];
    const used = new Set<string>();

    for (const p of points) {
      const docId = typeof p.payload?.doc_id === 'string' ? p.payload.doc_id : '';
      const blockId = typeof p.payload?.block_id === 'string' ? p.payload.block_id : '';
      if (docId.trim().length === 0 || blockId.trim().length === 0) continue;

      const key = `${docId}|${blockId}`;
      if (excludeKeys.has(key)) continue;
      if (used.has(key)) continue;
      used.add(key);

      out.push({ docId, blockId, score: typeof p.score === 'number' ? p.score : 0 });
      if (out.length >= maxBlocks) break;
    }

    return out;
  }
}
