import type { RerankingItem } from '../definitions/reranking';

export function orderRerankingItems(
  ranking: readonly RerankingItem[],
): readonly RerankingItem[] {
  return [...ranking].sort((left, right) =>
    right.score - left.score || left.originalIndex - right.originalIndex
  );
}
