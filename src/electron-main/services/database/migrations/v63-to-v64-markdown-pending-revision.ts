import type Database from 'better-sqlite3';

/** 保留现有 Pending 身份和内容，只为后续更新及审阅决策补上单调版本。 */
export function migrateV63ToV64MarkdownPendingRevision(db: Database.Database): void {
  db.exec('ALTER TABLE markdown_block_pending_revisions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
}
