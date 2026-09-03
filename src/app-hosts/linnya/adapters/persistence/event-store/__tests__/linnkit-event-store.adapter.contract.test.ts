import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { graph } from 'linnkit/runtime-kernel';
import {
  createFinalAnswerChunkEvent,
  createUserInputEvent,
  routeRuntimeEvent,
  type RuntimeEvent,
} from 'linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../conversation.schema';
import { LinnyaEventStoreAdapter } from '../linnkit-event-store.adapter';
import { SQLiteEventStore } from '../sqlite.implementation';

type PersistedEvent = graph.PersistedEvent;

interface EventStoreIdRow {
  event_store_id: string | null;
}

interface TableColumnRow {
  name: string;
}

function applyV23EventStoreIdMigration(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(events)').all() as TableColumnRow[];
  const columnNames = new Set(columns.map(column => column.name));
  if (!columnNames.has('event_store_id')) {
    db.exec('ALTER TABLE events ADD COLUMN event_store_id TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_store_id_unique
    ON events(event_store_id) WHERE event_store_id IS NOT NULL
  `);
}

function createStore(): {
  db: Database.Database;
  host: SQLiteEventStore;
  adapter: LinnyaEventStoreAdapter;
} {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  applyV23EventStoreIdMigration(db);

  const host = new SQLiteEventStore(db);
  return {
    db,
    host,
    adapter: new LinnyaEventStoreAdapter(db, host),
  };
}

function makeUserInput(id: string, conversationId: string, content: string, timestamp: number): RuntimeEvent {
  return createUserInputEvent(id, conversationId, `turn-${id}`, content, { timestamp });
}

function createPersistedEvent(
  eventStoreId: string,
  runId: string,
  conversationId: string,
  runtimeId: string,
  timestamp: number,
): PersistedEvent {
  return {
    eventStoreId,
    event: routeRuntimeEvent(
      makeUserInput(runtimeId, conversationId, `content-${runtimeId}`, timestamp),
      {
        run_id: runId,
        lane: 'foreground',
        visibility: 'conversation',
      },
    ),
  };
}

describe('LinnyaEventStoreAdapter - linnkit EventStore contract', () => {
  it('append fails fast when supervisor runId is not yet in SQLite', async () => {
    const { host, adapter } = createStore();
    const conversationId = 'conv-linnkit-auto-run';
    const seed = makeUserInput('seed-auto-run', conversationId, 'seed', 100);

    await host.ensureConversation(conversationId, [seed], undefined, 'agent');
    await expect(
      adapter.append(
        createPersistedEvent('0000000001000-0000', 'turn-supervisor-1', conversationId, 'runtime-auto-run-1', 1000),
      ),
    ).rejects.toThrow('does not exist');

    host.close();
  });

  it('append writes event_store_id and latestEventStoreId returns the latest storage cursor', async () => {
    const { db, host, adapter } = createStore();
    const conversationId = 'conv-linnkit-latest';
    const seed = makeUserInput('seed-latest', conversationId, 'seed', 100);

    await host.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await host.beginRunSession(conversationId, 'turn-linnkit-latest', { kind: 'agent' });
    await adapter.append(
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-latest-1', 1000),
    );
    await adapter.append(
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-latest-2', 1001),
    );

    await expect(adapter.latestEventStoreId(conversationId)).resolves.toBe('0000000001001-0000');
    const rows = db.prepare('SELECT event_store_id FROM events ORDER BY event_store_id ASC').all() as EventStoreIdRow[];
    expect(rows.map(row => row.event_store_id)).toEqual(['0000000001000-0000', '0000000001001-0000']);

    host.close();
  });

  it('range returns adapter-written events ordered by event_store_id and supports cursors and limit', async () => {
    const { host, adapter } = createStore();
    const conversationId = 'conv-linnkit-range';
    const seed = makeUserInput('seed-range', conversationId, 'seed', 100);

    await host.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await host.beginRunSession(conversationId, 'turn-linnkit-range', { kind: 'agent' });
    await adapter.append(
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-range-1', 1000),
    );
    await adapter.append(
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-range-2', 1001),
    );
    await adapter.append(
      createPersistedEvent('0000000001002-0000', session.runId, conversationId, 'runtime-range-3', 1002),
    );

    await expect(adapter.range(conversationId)).resolves.toEqual([
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-range-1', 1000),
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-range-2', 1001),
      createPersistedEvent('0000000001002-0000', session.runId, conversationId, 'runtime-range-3', 1002),
    ]);
    await expect(adapter.range(conversationId, { fromEventStoreId: '0000000001000-0000' })).resolves.toEqual([
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-range-2', 1001),
      createPersistedEvent('0000000001002-0000', session.runId, conversationId, 'runtime-range-3', 1002),
    ]);
    await expect(adapter.range(conversationId, { toEventStoreId: '0000000001001-0000' })).resolves.toEqual([
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-range-1', 1000),
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-range-2', 1001),
    ]);
    await expect(adapter.range(conversationId, { limit: 2 })).resolves.toEqual([
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-range-1', 1000),
      createPersistedEvent('0000000001001-0000', session.runId, conversationId, 'runtime-range-2', 1001),
    ]);

    host.close();
  });

  it('rejects realtime progress without mutating SQLite facts or read model', async () => {
    const { adapter, host, db } = createStore();
    const conversationId = 'conv-linnkit-ephemeral';
    const seed = makeUserInput('seed-ephemeral', conversationId, 'seed', 100);
    await host.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await host.beginRunSession(conversationId, 'turn-linnkit-ephemeral', { kind: 'agent' });
    const event = routeRuntimeEvent(
      createFinalAnswerChunkEvent('chunk-ephemeral', conversationId, 'turn-1', 'answer-1', 0, 'draft', {
        ephemeral: true,
      }),
      { run_id: session.runId, lane: 'foreground', visibility: 'conversation' },
    );

    await expect(adapter.append({ eventStoreId: '0000000001000-0000', event }))
      .rejects.toThrow('is not eligible for persistence');
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_ui_messages').get()).toEqual({ count: 0 });

    host.close();
  });

  it('relies on event_store_id unique index to reject duplicate adapter event ids', async () => {
    const { host, adapter } = createStore();
    const conversationId = 'conv-linnkit-duplicate';
    const seed = makeUserInput('seed-duplicate', conversationId, 'seed', 100);

    await host.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await host.beginRunSession(conversationId, 'turn-linnkit-duplicate', { kind: 'agent' });
    await adapter.append(
      createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-duplicate-1', 1000),
    );

    await expect(
      adapter.append(
        createPersistedEvent('0000000001000-0000', session.runId, conversationId, 'runtime-duplicate-2', 1001),
      ),
    ).rejects.toThrow();

    host.close();
  });

  it('throws for truncate because B3b does not implement event-grained deletion', async () => {
    const { adapter, host } = createStore();

    await expect(adapter.truncate?.('conv-linnkit-truncate', { beforeEventStoreId: '0000000001000-0000' })).rejects.toThrow(
      'not implemented',
    );

    host.close();
  });
});
