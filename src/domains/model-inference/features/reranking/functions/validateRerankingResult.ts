import { RerankingFailure, type RerankingItem } from '../definitions/reranking';

export function validateRerankingResult(
  documentCount: number,
  ranking: readonly RerankingItem[],
): void {
  const indices = new Set<number>();
  for (const item of ranking) {
    if (!Number.isInteger(item.originalIndex) || item.originalIndex < 0 || item.originalIndex >= documentCount) {
      throw new RerankingFailure('protocol', 'invalid_document_index', false, 'Reranking 返回了越界文档索引');
    }
    if (indices.has(item.originalIndex)) {
      throw new RerankingFailure('protocol', 'duplicate_document_index', false, 'Reranking 返回了重复文档索引');
    }
    if (!Number.isFinite(item.score)) {
      throw new RerankingFailure('protocol', 'non_finite_score', false, 'Reranking 返回了非有限分数');
    }
    indices.add(item.originalIndex);
  }
}
