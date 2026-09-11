import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteRunRegistryStore } from '../sqlite-run-registry.store';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

type RunRecord = runSupervisor.RunRecord;

function createStore(): { db: Database.Database; store: SQLiteRunRegistryStore } {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  db.prepare(
    `
    INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
    VALUES (?, 'test', 1, 1)
  `
  ).run('conv-run-registry');
  return { db, store: new SQLiteRunRegistryStore(db) };
}

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: RunIdSchema.parse('turn-registry-1'),
    conversationId: 'conv-run-registry',
    status: 'pending',
    agentSpecId: 'agent-default',
    startedAt: 1000,
    updatedAt: 1000,
    metadata: { turnId: 'turn-registry-1' },
    ...overrides,
  };
}

describe('SQLiteRunRegistryStore', () => {
  it('两个恢复入口竞争时仅一方成功，省略可选字段不造成虚假冲突', async () => {
    const { db, store } = createStore();
    const original = makeRecord({ status: 'paused', pausedAt: 1000 });
    await store.save(original);
    const results = await Promise.all(
      ['attempt-a', 'attempt-b'].map(executionId =>
        store.compareAndSwap(original, {
          ...original,
          status: 'running',
          pausedAt: undefined,
          updatedAt: 2000,
          metadata: { ...original.metadata, executionId },
        })
      )
    );
    expect(results).toEqual([true, false]);
    expect(await store.load(original.runId)).toMatchObject({
      status: 'running',
      metadata: { executionId: 'attempt-a' },
    });
    db.close();
  });

  it('saves and loads full linnkit RunRecord data', async () => {
    const { db, store } = createStore();
    const record = makeRecord({
      parentRunId: RunIdSchema.parse('parent-run'),
      status: 'running',
      currentNode: 'llm',
      updatedAt: 1200,
      iterationsUsed: 3,
      iterationBudget: { max: 10, refundable: true },
      errorIfAny: { errorCode: 'NONE', message: 'ok', recoverable: true },
    });

    await store.save(record);

    await expect(store.load(record.runId)).resolves.toEqual(record);
    expect(db.prepare('SELECT kind FROM runs WHERE id = ?').get(record.runId)).toEqual({
      kind: 'agent',
    });
    db.close();
  });

  it('updates the same runs row instead of creating a parallel run', async () => {
    const { db, store } = createStore();
    await store.save(makeRecord());
    await store.save(
      makeRecord({
        status: 'completed',
        currentNode: 'done',
        updatedAt: 2000,
      })
    );

    const rows = db.prepare('SELECT id, status, current_node FROM runs').all() as Array<{
      id: string;
      status: string;
      current_node: string | null;
    }>;
    expect(rows).toEqual([{ id: 'turn-registry-1', status: 'completed', current_node: 'done' }]);
    await expect(store.load('turn-registry-1')).resolves.toMatchObject({
      runId: 'turn-registry-1',
      status: 'completed',
      currentNode: 'done',
    });
    db.close();
  });

  it('sets end_ts for terminal status and clears it when the run becomes active again', async () => {
    const { db, store } = createStore();

    await store.save(
      makeRecord({
        status: 'completed',
        updatedAt: 2000,
      })
    );

    const completedRow = db
      .prepare('SELECT status, end_ts FROM runs WHERE id = ?')
      .get('turn-registry-1') as {
      status: string;
      end_ts: number | null;
    };
    expect(completedRow).toEqual({ status: 'completed', end_ts: 2000 });

    await store.save(
      makeRecord({
        status: 'running',
        updatedAt: 3000,
      })
    );

    const runningRow = db
      .prepare('SELECT status, end_ts FROM runs WHERE id = ?')
      .get('turn-registry-1') as {
      status: string;
      end_ts: number | null;
    };
    expect(runningRow).toEqual({ status: 'running', end_ts: null });
    db.close();
  });

  it('rejects saving an existing runId into another conversation', async () => {
    const { db, store } = createStore();
    db.prepare(
      `
      INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
      VALUES (?, 'other', 1, 1)
    `
    ).run('conv-other');

    await store.save(makeRecord());

    await expect(store.save(makeRecord({ conversationId: 'conv-other' }))).rejects.toThrow(
      'belongs to conversation conv-run-registry'
    );

    await expect(store.load('turn-registry-1')).resolves.toMatchObject({
      conversationId: 'conv-run-registry',
    });
    db.close();
  });

  it('lists by status, parentRunId, agentSpecId and cursor', async () => {
    const { db, store } = createStore();
    await store.save(
      makeRecord({
        runId: RunIdSchema.parse('turn-a'),
        status: 'completed',
        startedAt: 1000,
        updatedAt: 1000,
      })
    );
    await store.save(
      makeRecord({
        runId: RunIdSchema.parse('turn-b'),
        status: 'running',
        parentRunId: RunIdSchema.parse('turn-a'),
        startedAt: 2000,
        updatedAt: 2000,
      })
    );
    await store.save(
      makeRecord({
        runId: RunIdSchema.parse('turn-c'),
        status: 'running',
        agentSpecId: 'agent-research',
        startedAt: 3000,
        updatedAt: 3000,
      })
    );

    await expect(store.list({ status: 'running' })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({ runId: 'turn-c' }),
        expect.objectContaining({ runId: 'turn-b' }),
      ],
    });
    await expect(store.list({ parentRunId: RunIdSchema.parse('turn-a') })).resolves.toMatchObject({
      runs: [expect.objectContaining({ runId: 'turn-b' })],
    });
    await expect(store.list({ agentSpecId: 'agent-research' })).resolves.toMatchObject({
      runs: [expect.objectContaining({ runId: 'turn-c' })],
    });

    const firstPage = await store.list({ limit: 2 });
    expect(firstPage.runs.map(run => run.runId)).toEqual(['turn-c', 'turn-b']);
    expect(firstPage.nextCursor).toBe('2');
    const secondPage = await store.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.runs.map(run => run.runId)).toEqual(['turn-a']);
    expect(secondPage.nextCursor).toBeUndefined();

    db.close();
  });

  it('lists only runs owned by the requested conversation', async () => {
    const { db, store } = createStore();
    db.prepare(
      `
      INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
      VALUES (?, 'other', 1, 1)
    `
    ).run('conv-run-registry-other');
    await store.save(makeRecord({ runId: RunIdSchema.parse('turn-owned') }));
    await store.save(
      makeRecord({
        runId: RunIdSchema.parse('turn-other'),
        conversationId: 'conv-run-registry-other',
      })
    );

    await expect(store.list({ conversationId: 'conv-run-registry' })).resolves.toMatchObject({
      runs: [expect.objectContaining({ runId: 'turn-owned' })],
    });
    db.close();
  });

  it('deletes an empty registry run by runId', async () => {
    const { db, store } = createStore();
    await store.save(makeRecord());
    await store.delete('turn-registry-1');

    await expect(store.load('turn-registry-1')).resolves.toBeNull();
    db.close();
  });

  it.each([
    {
      source: 'events',
      insert: (db: Database.Database) =>
        db
          .prepare(
            `
        INSERT INTO events (id, run_id, type, payload, ts) VALUES ('event-1', 'turn-registry-1', 'thought', '{}', 1)
      `
          )
          .run(),
    },
    {
      source: 'ui_projection',
      insert: (db: Database.Database) =>
        db
          .prepare(
            `
        INSERT INTO conversation_ui_messages (
          message_id, conversation_id, turn_id, role, message_type,
          sort_seq, timestamp, run_id
        ) VALUES (
          'ui-message-1', 'conv-run-registry', 'turn-registry-1', 'assistant', 'thought',
          1, 1, 'turn-registry-1'
        )
      `
          )
          .run(),
    },
  ])('rejects deleting a run that owns $source facts', async ({ source, insert }) => {
    const { db, store } = createStore();
    await store.save(makeRecord());
    insert(db);

    await expect(store.delete('turn-registry-1')).rejects.toThrow(`owns ${source} facts`);
    await expect(store.load('turn-registry-1')).resolves.not.toBeNull();
    db.close();
  });
});
