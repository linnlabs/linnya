import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandRunPermissionSnapshotV1Schema } from '@app/schemas/commands';
import { migrateV78ToV79ConversationCommandPermissions } from '../v78-to-v79-conversation-command-permissions';

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
});
