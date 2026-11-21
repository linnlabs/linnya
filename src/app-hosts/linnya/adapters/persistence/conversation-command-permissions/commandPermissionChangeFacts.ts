import type Database from 'better-sqlite3';
import {
  ConversationCommandPermissionChangeSchema,
  conversationMessageIdFromCommandPermissionChange,
  type ConversationCommandPermissionChange,
} from '@app/schemas/commands';
import type { NewUiMessageRow } from '../event-store/ui-projection/types';

/** 档位变更事实：时间线记录行的唯一来源。界面行可以删掉重建，这里不随之变化。 */
export interface PersistedCommandPermissionChange {
  readonly conversationId: string;
  readonly anchorEventRowId: number;
  readonly change: ConversationCommandPermissionChange;
}

/** 与客户端提示同一种锚点：接纳时对话里最后一个事件的位置。 */
export function readConversationLastEventRowId(db: Database.Database, conversationId: string): number {
  const row = db.prepare<[string], { last_rowid: number }>(`
    SELECT COALESCE(MAX(e.rowid), 0) AS last_rowid FROM events e
    JOIN runs r ON r.id = e.run_id WHERE r.conversation_id = ?
  `).get(conversationId);
  if (!row) throw new Error('Command permission change anchor query returned no row');
  return row.last_rowid;
}

export function readConversationCommandPermissionChanges(
  db: Database.Database,
  conversationId: string,
): readonly PersistedCommandPermissionChange[] {
  return db.prepare<[string], { anchor_event_rowid: number; fact: string }>(`
    SELECT anchor_event_rowid, fact FROM conversation_command_permission_changes
    WHERE conversation_id = ? ORDER BY anchor_event_rowid, revision
  `).all(conversationId).map(row => ({
    conversationId,
    anchorEventRowId: row.anchor_event_rowid,
    change: ConversationCommandPermissionChangeSchema.parse(JSON.parse(row.fact)),
  }));
}

export function projectCommandPermissionChangeToUiRow(
  fact: PersistedCommandPermissionChange,
): Extract<NewUiMessageRow, { messageType: 'command_permission_change' }> {
  return {
    messageId: conversationMessageIdFromCommandPermissionChange(fact.conversationId, fact.change.revision),
    conversationId: fact.conversationId,
    turnId: null,
    runId: null,
    timestamp: fact.change.changed_at_ms,
    role: 'system',
    messageType: 'command_permission_change',
    content: null,
    attachments: null,
    payload: fact.change,
    mergeKey: null,
    presentation: null,
  };
}

/**
 * 截断历史后，锚在被删事件上的变更移到保留部分的末尾：档位确实改过，记录不删；
 * 这样重建出的顺序与现有界面行（保留原排序，新消息排在后面）一致。
 */
export function reanchorCommandPermissionChangesFromRuns(
  db: Database.Database,
  conversationId: string,
  runIds: readonly string[],
): void {
  if (runIds.length === 0) return;
  const placeholders = runIds.map(() => '?').join(',');
  const first = db.prepare<unknown[], { first_rowid: number | null }>(
    `SELECT MIN(rowid) AS first_rowid FROM events WHERE run_id IN (${placeholders})`,
  ).get(...runIds)?.first_rowid;
  if (first === null || first === undefined) return;
  db.prepare(`UPDATE conversation_command_permission_changes SET anchor_event_rowid = ?
    WHERE conversation_id = ? AND anchor_event_rowid >= ?`).run(first - 1, conversationId, first);
}
