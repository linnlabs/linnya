import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

import { pruneVersionTable, type VersionRetentionPolicy } from 'src/shared/database/versionRetention';
import type {
  MarkdownDocumentVersion,
  SaveMarkdownDocumentVersionInput,
} from '../../definitions/documentVersion';
import { MarkdownDocumentVersionReader } from './markdownDocumentVersionReader';
import { createMarkdownReadDatabase } from '../../../../infrastructure/sqlite/markdownReadDatabaseAdapter';

const MARKDOWN_VERSION_RETENTION_POLICY: VersionRetentionPolicy = {
  keepFirst: true,
  keepRecent: 15,
  sparseBucketDays: 3,
  keepSparseBuckets: 5,
};

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

    const pruned = pruneVersionTable({
      db: this.db,
      tableName: 'document_versions',
      nodeIdColumn: 'node_id',
      versionColumn: 'version_number',
      createdAtColumn: 'created_at',
      nodeId: input.nodeId,
      policy: MARKDOWN_VERSION_RETENTION_POLICY,
    });
    if (pruned.removed > 0) {
      console.log(
        `[MarkdownDocumentVersionRepository] pruned document versions: nodeId=${input.nodeId}, `
          + `removed=${pruned.removed}, kept=${pruned.kept}`
      );
    }

    const saved = this.get(input.nodeId, versionNumber);
    if (!saved) {
      throw new Error(`Markdown document version was not persisted: nodeId=${input.nodeId}, version=${versionNumber}`);
    }
    return saved;
  }
}
