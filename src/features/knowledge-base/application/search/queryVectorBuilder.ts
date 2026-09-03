/**
 * @file src/features/knowledge-base/application/search/queryVectorBuilder.ts
 *
 * @brief QueryVectorBuilder：负责“把 query 变成可用的 number[] 向量”（高内聚）。
 *
 * 设计原则：
 * - 只做 embed + 严格格式校验，不做任何检索；
 * - 统一收敛 queryVector 的生成入口，避免同一次请求重复 embed；
 * - 这里的抛错是“业务前置条件显式化”，不是补丁式兜底。
 */

import type { EmbeddingPort } from 'src/domains/model-inference';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';

export class KnowledgeBaseEmbeddingMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseEmbeddingMismatchError';
  }
}

export class QueryVectorBuilder {
  private readonly metadataRepository: MetadataRepository;
  private readonly embedding: EmbeddingPort;

  constructor(args: { metadataRepository: MetadataRepository; embedding: EmbeddingPort }) {
    this.metadataRepository = args.metadataRepository;
    this.embedding = args.embedding;
  }

  /**
   * 将 embedding 输出严格收敛为 number[]（失败直接抛错）。
   */
  private toNumberVectorOrThrow(embedding: unknown, context: string): number[] {
    if (!Array.isArray(embedding)) {
      throw new Error(`${context}：embedding 返回格式非法（不是数组）`);
    }
    const out: number[] = [];
    for (const n of embedding) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new Error(`${context}：embedding 返回格式非法（元素不是有限数字）`);
      }
      out.push(n);
    }
    if (out.length === 0) {
      throw new Error(`${context}：embedding 为空数组`);
    }
    return out;
  }

  /**
   * 统一生成（或复用）本次请求的 queryVector。
   * - 只做 embed，不做任何检索逻辑。
   */
  async buildQueryVectorOrThrow(args: {
    kbId: string;
    query: string;
    requestedEmbeddingModelId?: string | null;
  }): Promise<{ embeddingModelId: string; queryVector: number[] }> {
    const { kbId, query } = args;
    const kb = await this.metadataRepository.getKnowledgeBaseById(kbId);
    if (!kb) throw new Error(`找不到知识库: ${kbId}`);
    const embeddingModelId = await this.metadataRepository.getKnowledgeBaseEmbeddingProvenance(kbId);
    if (
      args.requestedEmbeddingModelId &&
      embeddingModelId &&
      args.requestedEmbeddingModelId !== embeddingModelId
    ) {
      throw new KnowledgeBaseEmbeddingMismatchError(
        `知识库 ${kbId} 的索引用 ${embeddingModelId} 构建，当前全局嵌入模型是 ${args.requestedEmbeddingModelId}。请清空并重新导入该知识库后再搜索。`
      );
    }
    if (!embeddingModelId || embeddingModelId.trim().length === 0) {
      throw new Error(`知识库 ${kbId} 没有关联嵌入模型`);
    }
    const result = await this.embedding.embed({ modelId: embeddingModelId, values: [query] });
    const embedding = result.vectors[0];
    const queryVector = this.toNumberVectorOrThrow(embedding, '生成 queryVector 失败');
    return { embeddingModelId, queryVector };
  }
}
