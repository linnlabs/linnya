import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { CommandAgentRunIdSchema, type CommandPermissionLevel } from '@app/schemas/commands';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  readCommandPermissionSettings,
  serializeCommandPermissionSettings,
  type CommandRunPermissionContext,
} from 'src/domains/commands/features/permission-settings';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import { resolveCommandRunPermissionContext } from '../../../adapters/context-injection/commandRunPermissionContextBinding';
import { SqliteConversationCommandPermissions } from '../../../adapters/persistence/conversation-command-permissions/sqliteConversationCommandPermissions';
import type { PersistedCommandPermissionChange } from '../../../adapters/persistence/conversation-command-permissions/commandPermissionChangeFacts';
import { CONVERSATION_COMMAND_PERMISSION_SCHEMAS } from '../../../adapters/persistence/conversation-command-permissions/schema';
import { createConversationCommandPermissions } from '..';

function createFixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY, project_id TEXT, created_at INTEGER, last_event_at INTEGER
    );
    CREATE TABLE runs (id TEXT PRIMARY KEY, conversation_id TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, run_id TEXT);
  `);
  for (const ddl of CONVERSATION_COMMAND_PERMISSION_SCHEMAS) db.exec(ddl);
  let serialized = serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS);
  let failGlobalWrite = false;
  const globalSettings: CommandPermissionSettingsPort = {
    read: () => ({ status: 'found', serialized }),
    write(value) {
      if (failGlobalWrite) return { status: 'failed', message: 'fixture write failure' };
      serialized = value;
      return { status: 'written' };
    },
  };
  const projected: PersistedCommandPermissionChange[] = [];
  const store = new SqliteConversationCommandPermissions(db, fact => projected.push(fact));
  const start = () => createConversationCommandPermissions({
    store,
    globalSettings,
    admission: { async withAdmission(request, admitted) {
      return admitted({
        identity: deriveConversationWorkDirectoryIdentity(request.conversationId),
        status: 'existing',
        absolutePath: '/fixture',
      });
    } },
    onFailure() {},
  });
  const permissions = start();
  const target = (id: string) => ({ conversation_id: id, project_id: null });
  return {
    db, start, permissions, globalSettings, target, projected,
    failGlobalWrite(value: boolean) { failGlobalWrite = value; },
    async change(id: string, permission_level: CommandPermissionLevel, expected_revision = 0) {
      const result = await permissions.request({
        kind: 'set', target: target(id), create: expected_revision === 0,
        expected_revision, expected_global_revision: readCommandPermissionSettings(globalSettings).revision,
        permission_level,
      });
      expect(result.kind).toBe('view');
    },
    snapshot(id: string, runId: string, owner: object, executionKind: 'start' | 'resume'): CommandRunPermissionContext {
      return resolveCommandRunPermissionContext({
        runOwner: owner, executionKind, rootAgentRunId: CommandAgentRunIdSchema.parse(runId),
        settingsPort: globalSettings, readConversation: () => permissions.readSelection(id),
      });
    },
  };
}

describe('conversation command permission lifecycle', () => {
  it('freezes distinct base permissions for two conversations and retains the resumed snapshot', async () => {
    const fixture = createFixture();
    try {
      await fixture.change('A', 'read_only');
      const a = {};
      const aSnapshot = fixture.snapshot('A', 'run-a', a, 'start');
      const bSnapshot = fixture.snapshot('B', 'run-b', {}, 'start');
      expect(aSnapshot).toMatchObject({ snapshot: { permission_level: 'read_only', source: 'conversation_setting' } });
      expect(bSnapshot).toMatchObject({ snapshot: { permission_level: 'standard', source: 'global_setting' } });

      await fixture.change('A', 'full_access', 1);
      expect(fixture.snapshot('A', 'run-a', a, 'resume')).toBe(aSnapshot);
      expect(fixture.snapshot('A', 'run-a-next', {}, 'start')).toMatchObject({
        snapshot: { permission_level: 'full_access', conversation_revision: 2 },
      });
      fixture.db.prepare("UPDATE conversation_command_permissions SET permission_level = 'standard' WHERE conversation_id = 'A'").run();
      expect(fixture.snapshot('A', 'run-a-later', {}, 'start')).toMatchObject({
        snapshot: { permission_level: 'full_access', conversation_revision: 2 },
      });
    } finally {
      fixture.db.close();
    }
  });

  it('lets the Host initialize a new conversation once without granting a desktop or tool action', async () => {
    const fixture = createFixture();
    try {
      const target = fixture.target('scheduled-conversation');
      await fixture.permissions.initializeForNewConversation(target, 'read_only');
      expect(fixture.snapshot(target.conversation_id, 'future-run', {}, 'start')).toMatchObject({
        snapshot: { permission_level: 'read_only', source: 'conversation_setting' },
      });
      await expect(fixture.permissions.initializeForNewConversation(target, 'full_access')).rejects.toThrow('对话已存在');
      expect(fixture.projected).toMatchObject([
        { conversationId: target.conversation_id, change: { origin: 'host_initialization', next_selection: 'read_only' } },
      ]);
    } finally {
      fixture.db.close();
    }
  });

  it('revalidates a reduction preview and allows changing only the global setting', async () => {
    const fixture = createFixture();
    try {
      await fixture.change('A', 'full_access');
      const before = await fixture.permissions.request({ kind: 'preview_reduction', permission_level: 'read_only' });
      if (before.kind !== 'preview') throw new Error('expected preview');
      await fixture.change('A', 'standard', 1);
      expect(await fixture.permissions.request({
        kind: 'reduce', preview: before.preview, include_conversations: true,
      })).toEqual({ kind: 'error', code: 'conflict' });
      const current = await fixture.permissions.request({ kind: 'preview_reduction', permission_level: 'read_only' });
      if (current.kind !== 'preview') throw new Error('expected preview');
      expect(await fixture.permissions.request({
        kind: 'reduce', preview: current.preview, include_conversations: false,
      })).toEqual({ kind: 'reduced', changed_count: 0 });
      expect(fixture.snapshot('A', 'run-a', {}, 'start')).toMatchObject({
        snapshot: { permission_level: 'standard', source: 'conversation_setting' },
      });
      expect(fixture.snapshot('B', 'run-b', {}, 'start')).toMatchObject({
        snapshot: { permission_level: 'read_only', source: 'global_setting' },
      });
    } finally {
      fixture.db.close();
    }
  });

  it('reconciles a failed global write without duplicating the committed per-conversation changes', async () => {
    const fixture = createFixture();
    try {
      await fixture.change('A', 'full_access');
      await fixture.change('B', 'standard');
      await fixture.change('C', 'read_only');
      const result = await fixture.permissions.request({ kind: 'preview_reduction', permission_level: 'read_only' });
      if (result.kind !== 'preview') throw new Error('expected preview');
      expect(result.preview.affected_count).toBe(2);
      fixture.failGlobalWrite(true);
      expect(await fixture.permissions.request({
        kind: 'reduce', preview: result.preview, include_conversations: true,
      })).toEqual({ kind: 'partial', changed_count: 2 });
      expect(readCommandPermissionSettings(fixture.globalSettings).permission_level).toBe('standard');
      fixture.failGlobalWrite(false);
      const restarted = fixture.start();
      expect(readCommandPermissionSettings(fixture.globalSettings).permission_level).toBe('read_only');
      expect(await restarted.request({ kind: 'read', target: fixture.target('A') })).toMatchObject({
        kind: 'view', view: { selection: { permission_level: 'read_only', revision: 2 } },
      });
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM conversation_command_permission_changes').get())
        .toEqual({ count: 5 });
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM pending_command_permission_reduction').get())
        .toEqual({ count: 0 });
    } finally {
      fixture.db.close();
    }
  });
});
