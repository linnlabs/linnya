import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { readMarkdownVfsContent } from '../orchestration/readMarkdownVfsContent';

describe('readMarkdownVfsContent', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        author_id TEXT
      );
      CREATE TABLE markdown_block_pending_revisions (
        id TEXT PRIMARY KEY,
        document_node_id TEXT NOT NULL,
        target_block_id TEXT NOT NULL,
        new_markdown TEXT NOT NULL,
        source TEXT NOT NULL,
        operation TEXT,
        meta_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );
    `);
  });

  afterEach(() => db.close());

  it('从 Markdown 自有版本和 pending 表构建 current VFS 文本', () => {
    db.prepare(`
      INSERT INTO document_versions (
        id, node_id, version_number, content_json, char_count, created_at, author_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'version-2',
      'document-1',
      2,
      JSON.stringify({
        type: 'doc',
        content: [{
          type: 'rootBlock',
          attrs: { id: 'workspace-block-1' },
          content: [{ type: 'baseBlock', content: [{ type: 'text', text: '原文' }] }],
        }],
      }),
      2,
      1,
      null,
    );
    db.prepare(`
      INSERT INTO markdown_block_pending_revisions (
        id, document_node_id, target_block_id, new_markdown, source,
        operation, meta_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'pending-1',
      'document-1',
      'workspace-block-1',
      '修订稿',
      'ai',
      'update',
      JSON.stringify({ operation: 'update' }),
      2,
      null,
    );

    const result = readMarkdownVfsContent({
      db: createMarkdownReadDatabase(db),
      documentId: 'document-1',
    });

    expect(result).toMatchObject({
      contentType: 'text/markdown',
      text: '修订稿',
      metadata: {
        versionNumber: 2,
        versionId: 'version-2',
        view: 'current',
        pendingCount: 1,
      },
    });
  });

  it('没有正文版本时返回 null，不伪造空文档', () => {
    expect(readMarkdownVfsContent({
      db: createMarkdownReadDatabase(db),
      documentId: 'missing-document',
    })).toBeNull();
  });
});
