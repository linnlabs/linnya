import type { PendingRevisionMetadata } from '../../pending-revisions';
import type { DocumentVersion } from '../../document-storage';
import type { MarkdownDocJson } from '../../normalization/runtime';
import type { TextCharacterMetrics } from '@app/schemas';

export type MarkdownFileWriteOperation = 'update' | 'insert' | 'delete';

export class MarkdownFileWriteConflictError extends Error {
  readonly code = 'MARKDOWN_FILE_WRITE_CONFLICT';

  constructor() {
    super('Markdown current content changed after edit_file read it. No edit was committed. Use read_file to reload the current content, then retry the exact replacement.');
    this.name = 'MarkdownFileWriteConflictError';
  }
}

export interface MarkdownFileWriteEdit {
  readonly operation: MarkdownFileWriteOperation;
  readonly blockId: string;
  readonly ref: string;
}

export interface MarkdownFileWriteResult {
  readonly documentId: string;
  readonly edits: MarkdownFileWriteEdit[];
  readonly cancelledCount: number;
  readonly pendingCount: number;
  /** 提交后完整 current 视图中已接纳的去重来源数，不代表来源已核验。 */
  readonly citationSourceCount: number;
  /** 实际提交后 current 全文（含 pending 与批注）的字符计量。 */
  readonly textMetrics: TextCharacterMetrics;
  readonly currentText: string;
  readonly targetText: string;
  readonly createdAnnotationIds: readonly string[];
  readonly updatedAnnotationIds: readonly string[];
  readonly deletedAnnotationIds: readonly string[];
}

export interface MarkdownDocumentWriteStore {
  getDocument(documentId: string): MarkdownDocJson;
  getLatestVersion(documentId: string): DocumentVersion | null;
  updateDocument(documentId: string, content: MarkdownDocJson): DocumentVersion;
  getPendingRevisions(documentId: string): Array<{
    readonly target_block_id: string;
    readonly new_markdown: string | null;
    readonly operation?: 'insert' | 'update' | 'delete' | null;
    readonly meta_json: string | null;
  }>;
  runInTransaction<T>(fn: () => T): T;
  insertEmptyBlockAfter(documentId: string, anchorBlockId: string | null, newBlockId: string): void;
  clearPendingRevision(documentId: string, blockId: string): number;
  setPendingRevisionForToolIntent(params: {
    readonly documentId: string;
    readonly blockId: string;
    readonly newMarkdown: string;
    readonly source?: 'ai' | 'user' | 'tool';
    readonly meta?: PendingRevisionMetadata;
  }): { readonly cancelled: boolean };
}
