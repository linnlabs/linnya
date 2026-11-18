import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createUserInputEvent, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { ConversationUiMessageSchema } from '@app/schemas';
import type { ConversationCommandPermissionChange } from '@app/schemas/commands';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { SQLiteEventStore } from '../../event-store/sqlite.implementation';
import { SqliteUiProjectionApplier } from '../../event-store/ui-projection/sqliteApplier';
import { rebuildConversationUiProjection } from '../../event-store/ui-projection/rebuildConversation';
import { readTail } from '../../event-store/ui-projection/sqliteUiMessagesReader';
import { SqliteConversationCommandPermissions } from '../sqliteConversationCommandPermissions';

function setup() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
  for (const statement of CONVERSATION_SCHEMAS) db.exec(statement);
  const events = new SQLiteEventStore(db);
  const permissions = new SqliteConversationCommandPermissions(
    db,
    fact => new SqliteUiProjectionApplier(db).projectCommandPermissionChange(fact),
  );
  return { db, events, permissions };
}

function change(revision: number, previous: ConversationCommandPermissionChange['next_selection'], next: ConversationCommandPermissionChange['next_selection']): ConversationCommandPermissionChange {
  return {
    revision, changed_at_ms: 1_000 + revision, origin: 'desktop',
    previous_selection: previous, next_selection: next,
    previous_level: previous ?? 'standard', next_level: next ?? 'standard',
  };
}

async function sendMessage(events: SQLiteEventStore, runId: string, inputId: string) {
  const session = await events.beginRunSession('conv', runId, { kind: 'agent' });
  const input = createUserInputEvent(inputId, 'conv', `turn-${runId}`, inputId, { timestamp: 100 });
  await events.appendEventToRun(session, routeRuntimeEvent(input, { run_id: session.runId, lane: 'foreground', visibility: 'conversation' }));
  return input;
}

describe('command permission changes in the conversation timeline', () => {
  it('records each change where it happened, survives rebuild and keeps its place after truncation', async () => {
    const { db, events, permissions } = setup();
    await events.ensureConversation('conv', []);
    const write = (value: ConversationCommandPermissionChange) => permissions.transact(() => permissions.writeChange('conv', value));
    write(change(1, null, 'read_only'));
    await sendMessage(events, 'run-first', 'input-first');
    write(change(2, 'read_only', 'full_access'));
    const second = await sendMessage(events, 'run-second', 'input-second');

    const ids = () => db.prepare<[], { message_id: string }>(
      'SELECT message_id FROM conversation_ui_messages ORDER BY sort_seq',
    ).all().map(row => row.message_id);
    expect(ids()).toEqual(['command-permission:conv:1', 'input-first', 'command-permission:conv:2', 'input-second']);
    const tail = readTail(db, 'conv', 100);
    if (tail.status !== 'ready') throw new Error('window not ready');
    expect(ConversationUiMessageSchema.parse(tail.messages[2])).toMatchObject({
      message_type: 'command_permission_change', role: 'system', run_id: null, turn_id: null,
      timestamp: 1_002, payload: change(2, 'read_only', 'full_access'),
    });

    rebuildConversationUiProjection(db, 'conv', { force: true });
    expect(ids()).toEqual(['command-permission:conv:1', 'input-first', 'command-permission:conv:2', 'input-second']);

    // 截断第二条消息后，档位确实改过，记录留下；之后的新消息排在它后面，重建也一样。
    await events.truncateFromEvent('conv', second.id);
    await sendMessage(events, 'run-third', 'input-third');
    expect(ids()).toEqual(['command-permission:conv:1', 'input-first', 'command-permission:conv:2', 'input-third']);
    rebuildConversationUiProjection(db, 'conv', { force: true });
    expect(ids()).toEqual(['command-permission:conv:1', 'input-first', 'command-permission:conv:2', 'input-third']);

    await events.deleteConversation('conv');
    expect(db.prepare('SELECT * FROM conversation_command_permission_changes').all()).toHaveLength(0);
    db.close();
  });

  it('materializes a draft through the conversation owner and leaves it compatible with agent choice', async () => {
    const { db, events, permissions } = setup();
    permissions.transact(() => {
      permissions.materializeConversation({ conversation_id: 'draft', project_id: null }, 500);
      permissions.writeChange('draft', change(1, null, 'read_only'));
    });
    permissions.materializeConversation({ conversation_id: 'draft', project_id: null }, 900);
    expect(db.prepare('SELECT created_at, total_events, preview_text FROM conversations WHERE conversation_id = ?').get('draft'))
      .toEqual({ created_at: 500, total_events: 0, preview_text: null });
    expect(await events.updateSelectedAgent('draft', null, null)).toBe(true);
    db.exec("INSERT INTO projects VALUES ('project-a')");
    expect(await events.updateSelectedAgent('fresh', null, 'project-a')).toBe(true);
    expect(db.prepare('SELECT project_id FROM conversations WHERE conversation_id = ?').get('fresh')).toEqual({ project_id: 'project-a' });
    db.close();
  });

  it('rolls back the change when the timeline projection fails', async () => {
    const { db, events } = setup();
    await events.ensureConversation('conv', []);
    const failing = new SqliteConversationCommandPermissions(db, () => { throw new Error('projection unavailable'); });
    expect(() => failing.transact(() => failing.writeChange('conv', change(1, null, 'read_only')))).toThrow('projection unavailable');
    expect(db.prepare('SELECT * FROM conversation_command_permission_changes').all()).toHaveLength(0);
    expect(db.prepare('SELECT * FROM conversation_command_permissions').all()).toHaveLength(0);
    db.close();
  });
});
