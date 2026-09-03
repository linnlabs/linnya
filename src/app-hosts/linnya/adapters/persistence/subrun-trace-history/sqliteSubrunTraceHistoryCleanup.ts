import type Database from 'better-sqlite3';

/**
 * 会话删除与历史截断不能依赖连接级 foreign_keys 开关。
 * cleanup 只按 read model 的正式 conversation / parent run 绑定删除，不推断 child lifecycle。
 */
export class SqliteSubrunTraceHistoryCleanup {
  constructor(private readonly db: Database.Database) {}

  deleteForConversation(conversationId: string): void {
    this.db
      .prepare(
        `
      DELETE FROM subrun_trace_items
      WHERE subrun_id IN (
        SELECT subrun_id
        FROM subrun_trace_runs
        WHERE conversation_id = ?
      )
    `
      )
      .run(conversationId);
    this.db
      .prepare(
        `
      DELETE FROM subrun_trace_runs
      WHERE conversation_id = ?
    `
      )
      .run(conversationId);
  }

  deleteForParentRunIds(parentRunIds: readonly string[]): void {
    if (parentRunIds.length === 0) return;
    const placeholders = parentRunIds.map(() => '?').join(',');
    this.db
      .prepare(
        `
      DELETE FROM subrun_trace_items
      WHERE subrun_id IN (
        SELECT subrun_id
        FROM subrun_trace_runs
        WHERE parent_run_id IN (${placeholders})
      )
    `
      )
      .run(...parentRunIds);
    this.db
      .prepare(
        `
      DELETE FROM subrun_trace_runs
      WHERE parent_run_id IN (${placeholders})
    `
      )
      .run(...parentRunIds);
  }
}
