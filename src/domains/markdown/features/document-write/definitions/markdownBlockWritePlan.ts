import type { FlattenedMarkdownBlock } from '../../../shared';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';

export interface MarkdownBlockWriteCandidate {
  readonly block: FlattenedMarkdownBlock;
  readonly currentText: string;
  readonly pending: MarkdownPendingRevisionLike | undefined;
}

export type MarkdownBlockWriteStep =
  | { readonly kind: 'retain'; readonly candidate: MarkdownBlockWriteCandidate; readonly markdown: string }
  | { readonly kind: 'update'; readonly candidate: MarkdownBlockWriteCandidate; readonly markdown: string }
  | { readonly kind: 'cancel'; readonly candidate: MarkdownBlockWriteCandidate }
  | { readonly kind: 'delete'; readonly candidate: MarkdownBlockWriteCandidate }
  | { readonly kind: 'insert'; readonly markdown: string };
