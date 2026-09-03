import type { MarkdownReadDatabase } from '../../../../definitions/markdownReadDatabase';
import type {
  PendingRevision,
  PendingRevisionMetadata,
} from '../../definitions/pendingRevision';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePendingRevision(value: unknown): PendingRevision {
  if (!isRecord(value)) throw new Error('pending revisions query returned a non-object row');
  const operation = value.operation;
  const source = value.source;
  if (
    typeof value.id !== 'string'
    || typeof value.document_node_id !== 'string'
    || typeof value.target_block_id !== 'string'
    || typeof value.new_markdown !== 'string'
    || (source !== 'ai' && source !== 'user' && source !== 'tool')
    || (operation !== null && operation !== 'insert' && operation !== 'update' && operation !== 'delete')
    || (value.meta_json !== null && typeof value.meta_json !== 'string')
    || typeof value.created_at !== 'number'
    || (value.updated_at !== null && typeof value.updated_at !== 'number')
  ) {
    throw new Error('pending revisions query returned an invalid row');
  }
  return {
    id: value.id,
    document_node_id: value.document_node_id,
    target_block_id: value.target_block_id,
    new_markdown: value.new_markdown,
    source,
    operation,
    meta_json: value.meta_json,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

/** pending revisions 的只读边界，不向读取流程暴露写入 service。 */
export class MarkdownPendingRevisionReader {
  constructor(protected readonly readDb: MarkdownReadDatabase) {}

  getPendingRevisionById(id: string): PendingRevision | null {
    const row = this.readDb.get(`
      SELECT * FROM markdown_block_pending_revisions WHERE id = ?
    `, [id]);
    return row === undefined ? null : parsePendingRevision(row);
  }

  getPendingRevisions(documentId: string): PendingRevision[] {
    return this.readDb.all(`
      SELECT * FROM markdown_block_pending_revisions
      WHERE document_node_id = ?
      ORDER BY created_at ASC
    `, [documentId]).map(parsePendingRevision);
  }

  getPendingRevisionForBlock(documentId: string, blockId: string): PendingRevision | null {
    const row = this.readDb.get(`
      SELECT * FROM markdown_block_pending_revisions
      WHERE document_node_id = ? AND target_block_id = ?
    `, [documentId, blockId]);
    return row === undefined ? null : parsePendingRevision(row);
  }

  getPendingRevisionsCount(documentId: string): number {
    const result = this.readDb.get(`
      SELECT COUNT(*) as count
      FROM markdown_block_pending_revisions
      WHERE document_node_id = ?
    `, [documentId]);
    if (!isRecord(result) || typeof result.count !== 'number') {
      throw new Error('pending revisions count query returned an invalid row');
    }
    return result.count;
  }

  parseMetadata(revision: PendingRevision): PendingRevisionMetadata | null {
    if (!revision.meta_json) return null;
    try {
      const parsed: unknown = JSON.parse(revision.meta_json);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
