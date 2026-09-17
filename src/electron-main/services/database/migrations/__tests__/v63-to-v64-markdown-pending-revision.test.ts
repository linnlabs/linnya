import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateV63ToV64MarkdownPendingRevision } from '../v63-to-v64-markdown-pending-revision';

it('旧 Pending 增加版本后保留身份和内容，迁移异常可整体回滚', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE markdown_block_pending_revisions (id TEXT PRIMARY KEY, new_markdown TEXT NOT NULL)');
    db.prepare('INSERT INTO markdown_block_pending_revisions VALUES (?, ?)').run('pending-1', 'proposal');
    expect(() => db.transaction(() => {
      migrateV63ToV64MarkdownPendingRevision(db);
      throw new Error('interrupt migration');
    })()).toThrow('interrupt migration');
    expect(db.prepare('SELECT * FROM markdown_block_pending_revisions').get()).toEqual({ id: 'pending-1', new_markdown: 'proposal' });
    db.transaction(() => migrateV63ToV64MarkdownPendingRevision(db))();
    expect(db.prepare('SELECT * FROM markdown_block_pending_revisions').get()).toEqual({ id: 'pending-1', new_markdown: 'proposal', revision: 1 });
  } finally { db.close(); }
});
