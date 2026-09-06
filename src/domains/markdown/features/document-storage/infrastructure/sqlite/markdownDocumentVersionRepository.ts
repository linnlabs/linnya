import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

import { DocumentVersionListSchema } from '@app/schemas';
import { planDocumentVersionRetention } from 'src/domains/document-history';
import type {
  MarkdownDocumentVersion,
  SaveMarkdownDocumentVersionInput,
} from '../../definitions/documentVersion';
import { MarkdownDocumentVersionReader } from './markdownDocumentVersionReader';
import { createMarkdownReadDatabase } from '../../../../infrastructure/sqlite/markdownReadDatabaseAdapter';

/** `document_versions` 的唯一 SQLite 访问边界。 */
export class MarkdownDocumentVersionRepository extends MarkdownDocumentVersionReader {
  constructor(private readonly db: Database.Database) {
    super(createMarkdownReadDatabase(db));
  }

  save(input: SaveMarkdownDocumentVersionInput): MarkdownDocumentVersion {
    const latest = this.getLatest(input.nodeId);
    const versionNumber = latest ? latest.version_number + 1 : 1;
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO document_versions (
        id,
        node_id,
        version_number,
        content_json,
        char_count,
        created_at,
        author_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.nodeId,
      versionNumber,
      input.contentJson,
      input.charCount,
      input.createdAt,
      input.authorId
    );

    const rows = this.db.prepare<[string], { versionId: string; order: number; createdAt: number }>(`
      SELECT id AS versionId, version_number AS "order", created_at AS createdAt
      FROM document_versions WHERE node_id = ? ORDER BY version_number DESC
    `).all(input.nodeId);
    const versions = DocumentVersionListSchema.parse(rows.map((row, index) => ({
      ...row, isCurrent: index === 0,
    })));
    const plan = planDocumentVersionRetention(versions);
    const remove = this.db.prepare('DELETE FROM document_versions WHERE node_id = ? AND id = ?');
    this.db.transaction(() => {
      for (const versionId of plan.removeVersionIds) remove.run(input.nodeId, versionId);
    })();

    const saved = this.get(input.nodeId, versionNumber);
    if (!saved) {
      throw new Error(`Markdown document version was not persisted: nodeId=${input.nodeId}, version=${versionNumber}`);
    }
    return saved;
  }
}
