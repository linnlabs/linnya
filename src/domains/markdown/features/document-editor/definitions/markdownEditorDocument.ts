export interface MarkdownEditorPendingRevision {
  readonly id: string;
  readonly blockId: string;
  readonly newMarkdown: string;
  readonly source: string;
  readonly operation: string | null;
  readonly metaJson: string | null;
  readonly createdAt: number;
  readonly updatedAt: number | null;
}

export interface MarkdownEditorDocumentReadResult {
  readonly content: unknown;
  readonly pendingRevisions: readonly MarkdownEditorPendingRevision[];
  readonly versionNumber: number;
}

export interface MarkdownEditorDocumentWriteResult {
  readonly versionNumber: number;
}
