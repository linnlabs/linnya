import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandRunPermissionSnapshotV1Schema } from '@app/schemas/commands';
import { migrateV78ToV79ConversationCommandPermissions } from '../v78-to-v79-conversation-command-permissions';
import { CONVERSATION_SCHEMAS } from '../../../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { buildReadableConversationMatch } from '../../../../../app-hosts/linnya/adapters/persistence/readable-conversation/readableConversationMatch';

const OLD_UI_MESSAGE_CHECK = `CHECK ((message_type = 'client_notice' AND run_id IS NULL AND turn_id IS NULL)
      OR (message_type != 'client_notice' AND run_id IS NOT NULL AND turn_id IS NOT NULL))`;

/** v78 的 conversation 结构：界面消息表只允许客户端提示不挂运行。 */
function createV78ConversationSchema(db: Database.Database) {
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
  for (const statement of CONVERSATION_SCHEMAS) {
    db.exec(statement.replace(/CHECK \(\(message_type IN \('client_notice', 'command_permission_change'\)[\s\S]*?turn_id IS NOT NULL\)\)/, OLD_UI_MESSAGE_CHECK));
  }
}

function uiMessageDdl(db: Database.Database): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_ui_messages'").get() as { sql: string }).sql;
}

describe('v78→v79 persisted command permissions', () => {
  it('retains frozen levels for recoverable roots and children and preserves unavailable contexts', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE agent_run_descriptors (descriptor_json TEXT)');
      const insert = db.prepare('INSERT INTO agent_run_descriptors VALUES (?)');
      const snapshot = {
        protocol_version: 1, kind: 'command_run_permission_snapshot', root_agent_run_id: 'root-for-migration',
        settings_revision: 12, captured_at_ms: 1, permission_level: 'read_only',
        internal_data_access: 'denied', gui_control: 'denied', local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      };
      const root = { schemaVersion: 1, commandPermission: { status: 'available', snapshot } };
      insert.run(JSON.stringify(root));
      insert.run(JSON.stringify({ ...root, child: { parentRunId: 'root-for-migration' } }));
      const unavailable = { schemaVersion: 1, commandPermission: {
        status: 'unavailable', code: 'permission_settings_unavailable', reason: 'read_failed',
      } };
      insert.run(JSON.stringify(unavailable));

      migrateV78ToV79ConversationCommandPermissions(db);
      const rows = db.prepare<[], { descriptor_json: string }>(
        'SELECT descriptor_json FROM agent_run_descriptors ORDER BY rowid',
      ).all();
      for (const { descriptor_json } of rows.slice(0, 2)) {
        const migrated = CommandRunPermissionSnapshotV1Schema.parse(JSON.parse(descriptor_json).commandPermission.snapshot);
        expect(migrated).toEqual({ ...snapshot, source: 'global_setting', conversation_revision: 0 });
      }
      expect(JSON.parse(rows[2].descriptor_json)).toEqual(unavailable);
    } finally {
      db.close();
    }
  });

  it('rebuilds the timeline table in place so permission change rows fit, keeping rows, rowids and the full-text index', () => {
    const db = new Database(':memory:');
    try {
      createV78ConversationSchema(db);
      expect(uiMessageDdl(db)).toContain("message_type != 'client_notice'");
      db.exec(`
        INSERT INTO conversations (conversation_id, created_at, last_event_at) VALUES ('conv', 1, 1);
        INSERT INTO runs (id, conversation_id, kind, status, start_ts) VALUES ('run-1', 'conv', 'agent', 'completed', 1);
      `);
      db.prepare(`
        INSERT INTO conversation_ui_messages (rowid, message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp, content, run_id)
        VALUES (42, 'input-1', 'conv', 'turn-1', 'user', 'user_input', 1, 10, 'migrate this sentence', 'run-1')
      `).run();
      const insertChange = db.prepare(`
        INSERT INTO conversation_ui_messages (message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp, payload_json, run_id)
        VALUES ('command-permission:conv:1', 'conv', NULL, 'system', 'command_permission_change', 2, 20, '{}', NULL)
      `);
      expect(() => insertChange.run()).toThrow(/CHECK/);

      migrateV78ToV79ConversationCommandPermissions(db);
      // 迁移后 provider 会按当前 DDL 补齐触发器与索引。
      for (const statement of CONVERSATION_SCHEMAS) db.exec(statement);

      const fresh = new Database(':memory:');
      try {
        fresh.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
        for (const statement of CONVERSATION_SCHEMAS) fresh.exec(statement);
        expect(uiMessageDdl(db)).toBe(uiMessageDdl(fresh));
        const indexes = (target: Database.Database) => target.prepare(
          "SELECT name, sql FROM sqlite_master WHERE tbl_name = 'conversation_ui_messages' AND type IN ('index', 'trigger') ORDER BY name",
        ).all();
        expect(indexes(db)).toEqual(indexes(fresh));
      } finally {
        fresh.close();
      }
      expect(db.prepare("SELECT rowid, message_id FROM conversation_ui_messages").all()).toEqual([{ rowid: 42, message_id: 'input-1' }]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'conversation_ui_messages_v78'").get()).toBeUndefined();
      insertChange.run();
      expect(db.prepare(`
        SELECT message_rowid FROM conversation_readable_messages m
        JOIN conversation_readable_fts f ON f.rowid = m.message_rowid
        WHERE conversation_readable_fts MATCH ?
      `).all(buildReadableConversationMatch('sentence'))).toEqual([{ message_rowid: 42 }]);
    } finally {
      db.close();
    }
  });
});
