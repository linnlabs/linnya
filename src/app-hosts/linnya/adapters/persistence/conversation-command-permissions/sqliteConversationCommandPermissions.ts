import type Database from 'better-sqlite3';
import {
  CommandPermissionSettingsUpdateV1Schema,
  ConversationCommandPermissionSelectionSchema,
  type CommandPermissionSettingsUpdateV1,
  type ConversationCommandPermissionChange,
} from '@app/schemas/commands';

import type {
  ConversationCommandPermissionPersistencePort,
  ConversationPermissionTarget,
  StoredConversationPermissionSelection,
} from '../../../application/conversation-command-permissions';
import { materializeConversation } from '../event-store/functions/materializeConversation';
import { readConversationLastEventRowId, type PersistedCommandPermissionChange } from './commandPermissionChangeFacts';

type StoredTarget = ConversationPermissionTarget & { readonly created_at: number };

export class SqliteConversationCommandPermissions implements ConversationCommandPermissionPersistencePort {
  /** projectChange 在写入事务内把变更投影成时间线记录行（由事件库的界面投影负责）。 */
  constructor(
    private readonly db: Database.Database,
    private readonly projectChange: (fact: PersistedCommandPermissionChange) => void,
  ) {}

  loadSelections(): readonly StoredConversationPermissionSelection[] {
    return this.db.prepare<[], StoredConversationPermissionSelection>(`
      SELECT p.conversation_id, p.permission_level, p.revision, c.created_at
      FROM conversation_command_permissions p JOIN conversations c USING (conversation_id)
    `).all().map(({ conversation_id, created_at, ...value }) => ({
      conversation_id,
      created_at,
      ...ConversationCommandPermissionSelectionSchema.parse(value),
    }));
  }

  resolveTarget(conversationId: string): StoredTarget | null {
    return this.db.prepare<[string], StoredTarget>(`
      SELECT conversation_id, project_id, created_at FROM conversations WHERE conversation_id = ?
    `).get(conversationId) ?? null;
  }

  materializeConversation(target: ConversationPermissionTarget, createdAt: number): void {
    materializeConversation(this.db, { conversationId: target.conversation_id, projectId: target.project_id, at: createdAt });
  }

  writeChange(conversationId: string, change: ConversationCommandPermissionChange): void {
    this.db.prepare(`
      INSERT INTO conversation_command_permissions (conversation_id, permission_level, revision)
      VALUES (?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        permission_level = excluded.permission_level, revision = excluded.revision
    `).run(conversationId, change.next_selection, change.revision);
    const fact: PersistedCommandPermissionChange = {
      conversationId,
      anchorEventRowId: readConversationLastEventRowId(this.db, conversationId),
      change,
    };
    this.db.prepare(`
      INSERT INTO conversation_command_permission_changes (conversation_id, revision, anchor_event_rowid, fact)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, change.revision, fact.anchorEventRowId, JSON.stringify(change));
    this.projectChange(fact);
  }

  savePendingReduction(update: CommandPermissionSettingsUpdateV1, changedCount: number): void {
    this.db.prepare(`
      INSERT INTO pending_command_permission_reduction (singleton, update_json, changed_count)
      VALUES (1, ?, ?)
    `).run(JSON.stringify(update), changedCount);
  }

  readPendingReduction() {
    const row = this.db.prepare<[], { update_json: string; changed_count: number }>(`
      SELECT update_json, changed_count FROM pending_command_permission_reduction WHERE singleton = 1
    `).get();
    return row && {
      update: CommandPermissionSettingsUpdateV1Schema.parse(JSON.parse(row.update_json)),
      changedCount: row.changed_count,
    };
  }

  clearPendingReduction(): void {
    this.db.prepare('DELETE FROM pending_command_permission_reduction WHERE singleton = 1').run();
  }

  transact<T>(write: () => T): T {
    return this.db.transaction(write)();
  }
}
