import { KnowledgeIndexSpaceMismatchError } from '../../index-rebuild/definitions/knowledgeIndex';
/**
 * @file packages/plugins/knowledge/src/backend/application/search/queryVectorBuilder.ts
 *
 * @brief QueryVectorBuilder：负责“把 query 变成可用的 number[] 向量”（高内聚）。
 *
 * 设计原则：
 * - 只做 embed + 严格格式校验，不做任何检索；
 * - 统一收敛 queryVector 的生成入口，避免同一次请求重复 embed；
 * - 这里的抛错是“业务前置条件显式化”，不是补丁式兜底。
 */

import { type EmbeddingPort } from '@plugin/backend/inferenceRuntime';
import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';
import { KnowledgeSearchEmbeddingError } from './knowledgeSearchEmbeddingError';

import type { MetadataRepository } from '../../infrastructure/metadataRepository';

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
    const identity = this.metadataRepository.indexState.requireReady(kbId);
    const embeddingModelId = args.requestedEmbeddingModelId || identity.modelId;
    const result = await this.embedding
      .embed({
        modelId: embeddingModelId,
        values: [query],
        expectedSpaceId: identity.spaceId,
      })
      .catch((error: unknown) => {
        if (error instanceof EmbeddingFailure) {
          // 空间不一致的出路是重建索引，单独成类；其余 Host 失败按失败码归因，让检索报出原因而不是空结果。
          if (error.code === 'embedding_space_mismatch') throw new KnowledgeIndexSpaceMismatchError(kbId);
          throw new KnowledgeSearchEmbeddingError(error);
        }
        throw error;
      });
    const embedding = result.vectors[0];
    const queryVector = this.toNumberVectorOrThrow(embedding, '生成 queryVector 失败');
    return { embeddingModelId, queryVector };
  }
}
