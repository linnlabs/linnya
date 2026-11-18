import type Database from 'better-sqlite3';
import {
  CommandPermissionSettingsUpdateV1Schema,
  ConversationCommandPermissionChangeSchema,
  ConversationCommandPermissionSelectionSchema,
  ConversationRunCommandPermissionSchema,
  type CommandPermissionSettingsUpdateV1,
  type ConversationCommandPermissionChange,
  type ConversationRunCommandPermission,
} from '@app/schemas/commands';

import type {
  ConversationCommandPermissionPersistencePort,
  ConversationPermissionTarget,
  StoredConversationPermissionSelection,
} from '../../../application/conversation-command-permissions';

type StoredTarget = ConversationPermissionTarget & { readonly created_at: number };

export class SqliteConversationCommandPermissions implements ConversationCommandPermissionPersistencePort {
  constructor(private readonly db: Database.Database) {}

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

  createConversation(target: ConversationPermissionTarget, createdAt: number): void {
    this.db.prepare(`
      INSERT INTO conversations (conversation_id, project_id, created_at, last_event_at)
      VALUES (?, ?, ?, ?)
    `).run(target.conversation_id, target.project_id, createdAt, createdAt);
  }

  writeChange(conversationId: string, change: ConversationCommandPermissionChange): void {
    this.db.prepare(`
      INSERT INTO conversation_command_permissions (conversation_id, permission_level, revision)
      VALUES (?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        permission_level = excluded.permission_level, revision = excluded.revision
    `).run(conversationId, change.next_selection, change.revision);
    this.db.prepare(`
      INSERT INTO conversation_command_permission_changes (conversation_id, revision, fact)
      VALUES (?, ?, ?)
    `).run(conversationId, change.revision, JSON.stringify(change));
  }

  readChanges(conversationId: string): ConversationCommandPermissionChange[] {
    return this.db.prepare<[string], { fact: string }>(`
      SELECT fact FROM conversation_command_permission_changes WHERE conversation_id = ?
      ORDER BY revision DESC
    `).all(conversationId).map(({ fact }) => ConversationCommandPermissionChangeSchema.parse(JSON.parse(fact)));
  }

  readLatestRun(conversationId: string): ConversationRunCommandPermission | null {
    const row = this.db.prepare<[string], unknown>(`
      SELECT p.run_id, p.captured_at_ms, p.permission_level, p.source
      FROM conversation_run_command_permissions p JOIN runs r ON r.id = p.run_id
      WHERE p.conversation_id = ?
      ORDER BY p.captured_at_ms DESC, r.rowid DESC LIMIT 1
    `).get(conversationId);
    return row === undefined ? null : ConversationRunCommandPermissionSchema.parse(row);
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
