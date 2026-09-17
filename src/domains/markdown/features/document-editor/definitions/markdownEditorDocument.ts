import type { MarkdownPendingRevisionDTO } from '@app/schemas';

export type MarkdownEditorPendingRevision = MarkdownPendingRevisionDTO;

export interface MarkdownEditorDocumentReadResult {
  readonly content: unknown;
  readonly pendingRevisions: readonly MarkdownEditorPendingRevision[];
  readonly versionNumber: number;
}

export interface MarkdownEditorDocumentWriteResult {
  readonly versionNumber: number;
}
