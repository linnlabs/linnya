export interface PageSelectionNode {
  readonly id: string;
  readonly type: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
}

export type PageSelectionAfterRemovalDecision =
  | { readonly kind: 'preserve-active'; readonly documentId: string }
  | { readonly kind: 'select-page'; readonly documentId: string }
  | { readonly kind: 'empty' };
