export interface DocumentListPresentationItem {
  readonly id: string;
  readonly title: string;
}

export type DocumentListPresentationData =
  | { readonly kind: 'lifecycle' }
  | {
      readonly kind: 'snapshot';
      readonly documents: readonly DocumentListPresentationItem[];
    };
