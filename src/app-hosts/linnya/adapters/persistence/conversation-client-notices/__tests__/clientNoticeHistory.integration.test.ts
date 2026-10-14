import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createUserInputEvent, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { SQLiteEventStore } from '../../event-store/sqlite.implementation';
import { SqliteUiProjectionApplier } from '../../event-store/ui-projection/sqliteApplier';
import { rebuildConversationUiProjection } from '../../event-store/ui-projection/rebuildConversation';
import { readTail } from '../../event-store/ui-projection/sqliteUiMessagesReader';
import { createSqliteClientNoticeAdmission } from '../sqliteClientNoticeAdmission';
import { ConversationClientNoticeCommandSchema, ConversationUiMessageSchema } from '@app/schemas';

function setup() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
  for (const statement of CONVERSATION_SCHEMAS) db.exec(statement);
  const store = new SQLiteEventStore(db);
  const admission = createSqliteClientNoticeAdmission({ db, now: () => 123, project: fact => new SqliteUiProjectionApplier(db).projectClientNotice(fact) });
  return { db, store, admission };
}
function command() { return ConversationClientNoticeCommandSchema.parse({ notice_id: randomUUID(), observed_at: 30, error_kind: 'connection', operation: 'send' }); }

describe('client notice durable history', () => {
  it('accepts without a run; duplicate admission returns original receipt; strict payload cannot inject runtime/raw fields', async () => {
    const { db, store, admission } = setup();
    await store.ensureConversation('conv', []);
    const input = command();
    const result = admission.accept('conv', input);
    expect(admission.accept('conv', input)).toEqual(result);
    expect(admission.accept('conv', { ...input, operation: 'pause' })).toEqual({ status: 'identity-conflict' });
    expect(admission.accept('missing', command())).toEqual({ status: 'conversation-not-found' });
    expect(() => admission.accept('conv', ConversationClientNoticeCommandSchema.parse({ ...input, run_id: 'fake', message: 'secret raw body' }))).toThrow();
    const rows = readTail(db, 'conv', 100);
    expect(rows.status).toBe('ready');
    if (rows.status !== 'ready') throw new Error('not ready');
    expect(rows.messages).toHaveLength(1);
    expect(ConversationUiMessageSchema.parse(rows.messages[0])).toMatchObject({ message_type: 'client_notice', run_id: null, turn_id: null, payload: { origin: 'client' } });
    expect(db.prepare('SELECT * FROM events').all()).toHaveLength(0);
    expect(db.prepare('SELECT * FROM runs').all()).toHaveLength(0);
    db.close();
  });

  it('rebuild keeps acceptance order around runtime messages, truncate/delete remove facts without resurrection', async () => {
    const { db, store, admission } = setup();
    await store.ensureConversation('conv', []);
    const before = command();
    admission.accept('conv', before);
    const first = await store.beginRunSession('conv', 'run-first', { kind: 'agent' });
    const firstInput = createUserInputEvent('input-first', 'conv', 'turn-first', 'hello', { timestamp: 100 });
    await store.appendEventToRun(first, routeRuntimeEvent(firstInput, { run_id: first.runId, lane: 'foreground', visibility: 'conversation' }));
    const between = command();
    admission.accept('conv', between);
    const second = await store.beginRunSession('conv', 'run-second', { kind: 'agent' });
    const secondInput = createUserInputEvent('input-second', 'conv', 'turn-second', 'again', { timestamp: 100 });
    await store.appendEventToRun(second, routeRuntimeEvent(secondInput, { run_id: second.runId, lane: 'foreground', visibility: 'conversation' }));
    const after = command();
    admission.accept('conv', after);
    const ids = () => db.prepare<[], { message_id: string }>('SELECT message_id FROM conversation_ui_messages ORDER BY sort_seq').all().map(row => row.message_id);
    const original = ids();
    rebuildConversationUiProjection(db, 'conv', { force: true });
    expect(ids()).toEqual(original);
    await store.truncateFromEvent('conv', secondInput.id);
    const redelivery = admission.accept('conv', after);
    expect(redelivery).toMatchObject({ status: 'accepted', receipt: { state: 'removed' } });
    rebuildConversationUiProjection(db, 'conv', { force: true });
    expect(ids()).toEqual(original.slice(0, 3));
    await store.deleteConversation('conv');
    expect(db.prepare('SELECT * FROM conversation_client_notices').all()).toHaveLength(0);
    db.close();
  });

  it('rolls back the fact when projection fails, so retry is safe', async () => {
    const { db, store } = setup();
    await store.ensureConversation('conv', []);
    const admission = createSqliteClientNoticeAdmission({ db, project: () => { throw new Error('projection unavailable'); } });
    expect(() => admission.accept('conv', command())).toThrow('projection unavailable');
    expect(db.prepare('SELECT * FROM conversation_client_notices').all()).toHaveLength(0);
    db.close();
  });
});
