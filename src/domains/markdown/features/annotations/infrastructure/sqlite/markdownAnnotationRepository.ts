import type Database from 'better-sqlite3';

import type { MarkdownAnnotation } from '../../definitions/markdownAnnotation';

interface InsertMarkdownAnnotationInput {
  readonly id: string;
  readonly documentNodeId: string;
  readonly targetBlockId: string;
  readonly contentJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function parseAnnotationContent(contentJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(contentJson);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Annotation content_json must contain an object');
  }
  return parsed as Record<string, unknown>;
}

/** `annotations` 表的唯一 SQLite 访问边界。 */
export class MarkdownAnnotationRepository {
  constructor(private readonly db: Database.Database) {}

  listForDocument(documentNodeId: string): MarkdownAnnotation[] {
    return this.db.prepare(`
      SELECT * FROM annotations
      WHERE document_node_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `).all(documentNodeId) as MarkdownAnnotation[];
  }

  insert(input: InsertMarkdownAnnotationInput): MarkdownAnnotation {
    this.db.prepare(`
      INSERT INTO annotations (id, document_node_id, target_block_id, content_json, created_at, updated_at)
      VALUES (@id, @documentNodeId, @targetBlockId, @contentJson, @createdAt, @updatedAt)
    `).run(input);

    const created = this.db.prepare('SELECT * FROM annotations WHERE id = ?')
      .get(input.id) as MarkdownAnnotation | undefined;
    if (!created) {
      throw new Error(`Annotation was not persisted: ${input.id}`);
    }
    return created;
  }

  updateContent(id: string, updates: Readonly<Record<string, unknown>>, updatedAt: number): void {
    const row = this.db.prepare(
      'SELECT content_json FROM annotations WHERE id = ? AND deleted_at IS NULL'
    ).get(id) as { content_json: string } | undefined;
    if (!row) {
      throw new Error(`Annotation with id ${id} not found or already deleted`);
    }

    const content = { ...parseAnnotationContent(row.content_json), ...updates };
    const result = this.db.prepare(`
      UPDATE annotations
      SET content_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(content), updatedAt, id);
    if (result.changes === 0) {
      throw new Error(`Annotation with id ${id} not found during update`);
    }
  }

  softDelete(id: string, deletedAt: number): void {
    const result = this.db.prepare(`
      UPDATE annotations
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(deletedAt, deletedAt, id);
    if (result.changes === 0) {
      throw new Error(`Annotation with id ${id} not found or already deleted`);
    }
  }
}
