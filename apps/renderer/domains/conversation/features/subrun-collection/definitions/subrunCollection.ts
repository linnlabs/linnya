import type { SubrunCardPresentation } from '../../subrun-card/definitions/subrunCard';

export type SubrunCollectionItemStatus = 'loading' | 'success' | 'error';

export interface SubrunCollectionItem {
  readonly subrunId: string;
  readonly presentation: SubrunCardPresentation;
}

export interface SubrunBatchPresentationData {
  readonly items: readonly SubrunCollectionItem[];
}
