import type { MarkdownReadDatabase } from '../../../../definitions/markdownReadDatabase';
import type { MarkdownDocumentVersion } from '../../definitions/documentVersion';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseDocumentVersion(value: unknown): MarkdownDocumentVersion | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const nodeId = value.node_id;
  const versionNumber = value.version_number;
  const contentJson = value.content_json;
  const charCount = value.char_count;
  const createdAt = value.created_at;
  const authorId = value.author_id;
  if (
    typeof id !== 'string'
    || typeof nodeId !== 'string'
    || typeof versionNumber !== 'number'
    || typeof contentJson !== 'string'
    || typeof charCount !== 'number'
    || typeof createdAt !== 'number'
    || (authorId !== null && typeof authorId !== 'string')
  ) {
    throw new Error('document_versions returned an invalid Markdown version row');
  }
  return {
    id,
    node_id: nodeId,
    version_number: versionNumber,
    content_json: contentJson,
    char_count: charCount,
    created_at: createdAt,
    author_id: authorId,
  };
}

/** `document_versions` 的只读边界，可由 VFS 和完整 repository 共同复用。 */
export class MarkdownDocumentVersionReader {
  constructor(protected readonly readDb: MarkdownReadDatabase) {}

  getLatest(nodeId: string): MarkdownDocumentVersion | null {
    return parseDocumentVersion(this.readDb.get(`
      SELECT * FROM document_versions
      WHERE node_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `, [nodeId]));
  }

  get(nodeId: string, versionNumber: number): MarkdownDocumentVersion | null {
    return parseDocumentVersion(this.readDb.get(`
      SELECT * FROM document_versions
      WHERE node_id = ? AND version_number = ?
    `, [nodeId, versionNumber]));
  }
}
