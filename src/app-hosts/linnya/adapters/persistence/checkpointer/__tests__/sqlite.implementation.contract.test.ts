import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { graph } from 'linnkit/runtime-kernel';

import { ENGINE_CHECKPOINTS_SCHEMA } from '../checkpointer.schema';
import { SqliteCheckpointer } from '../sqlite.implementation';
import { ToolCallIdSchema } from 'linnkit/contracts';

type EngineState = graph.EngineState;
type CheckpointSummary = graph.CheckpointSummary;

function createEngineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    nodeId: 'llm',
    schemaVersion: 1,
    local: {},
    ...overrides,
  };
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  for (const ddl of ENGINE_CHECKPOINTS_SCHEMA) {
    db.exec(ddl);
  }
  return db;
}

describe('SqliteCheckpointer contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists schemaVersion and exposes metadata without loading the full checkpoint', async () => {
    vi.setSystemTime(new Date('2026-04-22T09:30:00.000Z'));
    const db = freshDb();
    const checkpointer = new SqliteCheckpointer(db);

    await checkpointer.save(
      'conv-1',
      createEngineState({
        nodeId: 'answer',
        schemaVersion: 7,
        local: {
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('tool-1'),
              type: 'function',
              function: {
                name: 'lookup',
                arguments: '{}',
              },
            },
          ],
          executorLocal: { stepCount: 3 },
        },
      })
    );

    await expect(checkpointer.load('conv-1')).resolves.toMatchObject({
      nodeId: 'answer',
      schemaVersion: 7,
    });

    expect(checkpointer.peekMeta).toBeTypeOf('function');
    const peekMeta = checkpointer.peekMeta;
    if (!peekMeta) {
      throw new Error('SqliteCheckpointer.peekMeta must be implemented');
    }

    await expect(peekMeta.call(checkpointer, 'conv-1')).resolves.toEqual({
      checkpointKey: 'conv-1',
      schemaVersion: 7,
      savedAt: Date.parse('2026-04-22T09:30:00.000Z'),
      currentNode: 'answer',
      iterations: 3,
      hasPendingToolCalls: true,
    });

    db.close();
  });

  it('lists checkpoints with savedAfter and limit filters', async () => {
    const db = freshDb();
    const checkpointer = new SqliteCheckpointer(db);

    vi.setSystemTime(new Date('2026-04-22T09:00:00.000Z'));
    await checkpointer.save('conv-1', createEngineState({ nodeId: 'user', schemaVersion: 1 }));

    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
    await checkpointer.save('conv-2', createEngineState({ nodeId: 'llm', schemaVersion: 2 }));

    vi.setSystemTime(new Date('2026-04-22T11:00:00.000Z'));
    await checkpointer.save('conv-3', createEngineState({ nodeId: 'answer', schemaVersion: 3 }));

    expect(checkpointer.list).toBeTypeOf('function');
    const list = checkpointer.list;
    if (!list) {
      throw new Error('SqliteCheckpointer.list must be implemented');
    }

    const summaries = await list.call(checkpointer, {
      savedAfter: Date.parse('2026-04-22T09:30:00.000Z'),
      limit: 2,
    });

    expect(summaries).toEqual<CheckpointSummary[]>([
      {
        checkpointKey: 'conv-3',
        schemaVersion: 3,
        savedAt: Date.parse('2026-04-22T11:00:00.000Z'),
        currentNode: 'answer',
        iterations: undefined,
        hasPendingToolCalls: false,
      },
      {
        checkpointKey: 'conv-2',
        schemaVersion: 2,
        savedAt: Date.parse('2026-04-22T10:00:00.000Z'),
        currentNode: 'llm',
        iterations: undefined,
        hasPendingToolCalls: false,
      },
    ]);

    db.close();
  });

  it('save() upserts on conflict (latest write wins)', async () => {
    const db = freshDb();
    const checkpointer = new SqliteCheckpointer(db);

    vi.setSystemTime(new Date('2026-04-22T09:00:00.000Z'));
    await checkpointer.save('conv-1', createEngineState({ nodeId: 'user', schemaVersion: 1 }));

    vi.setSystemTime(new Date('2026-04-22T09:05:00.000Z'));
    await checkpointer.save(
      'conv-1',
      createEngineState({
        nodeId: 'answer',
        schemaVersion: 1,
        local: { executorLocal: { stepCount: 5 } },
      })
    );

    const loaded = await checkpointer.load('conv-1');
    expect(loaded?.nodeId).toBe('answer');

    const peekMeta = checkpointer.peekMeta;
    if (!peekMeta) throw new Error('peekMeta required');
    const meta = await peekMeta.call(checkpointer, 'conv-1');
    expect(meta?.currentNode).toBe('answer');
    expect(meta?.iterations).toBe(5);
    expect(meta?.savedAt).toBe(Date.parse('2026-04-22T09:05:00.000Z'));

    db.close();
  });

  it('clear() removes the row and load returns null', async () => {
    const db = freshDb();
    const checkpointer = new SqliteCheckpointer(db);

    await checkpointer.save('conv-1', createEngineState());
    await checkpointer.clear('conv-1');

    await expect(checkpointer.load('conv-1')).resolves.toBeNull();

    const peekMeta = checkpointer.peekMeta;
    if (!peekMeta) throw new Error('peekMeta required');
    await expect(peekMeta.call(checkpointer, 'conv-1')).resolves.toBeNull();

    db.close();
  });

  it('同一 conversation 的 foreground 与 auxiliary run 使用独立 checkpoint，清理标题 run 不影响等待中的正文 run', async () => {
    const db = freshDb();
    const checkpointer = new SqliteCheckpointer(db);
    const foregroundRunId = 'run-foreground-ppt';
    const titleRunId = 'run-auxiliary-title';

    await checkpointer.save(
      foregroundRunId,
      createEngineState({
        nodeId: 'wait_user',
        schemaVersion: 4,
        local: {
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('ask-ppt-requirements'),
              type: 'function',
              function: { name: 'ask', arguments: '{}' },
            },
          ],
        },
      })
    );
    await checkpointer.save(
      titleRunId,
      createEngineState({
        nodeId: 'answer',
        schemaVersion: 2,
      })
    );

    await expect(checkpointer.load(foregroundRunId)).resolves.toMatchObject({
      nodeId: 'wait_user',
      schemaVersion: 4,
    });
    await expect(checkpointer.load(titleRunId)).resolves.toMatchObject({
      nodeId: 'answer',
      schemaVersion: 2,
    });

    await checkpointer.clear(titleRunId);

    await expect(checkpointer.load(titleRunId)).resolves.toBeNull();
    await expect(checkpointer.load(foregroundRunId)).resolves.toMatchObject({
      nodeId: 'wait_user',
      local: {
        pendingToolCalls: [expect.objectContaining({ id: 'ask-ppt-requirements' })],
      },
    });

    db.close();
  });

  describe('purgeStale (host-side GC)', () => {
    it('deletes rows older than the cutoff and reports the count', async () => {
      const db = freshDb();
      const checkpointer = new SqliteCheckpointer(db);

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await checkpointer.save('conv-old-1', createEngineState({ nodeId: 'answer' }));
      await checkpointer.save('conv-old-2', createEngineState({ nodeId: 'answer' }));

      vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
      await checkpointer.save('conv-fresh', createEngineState({ nodeId: 'llm' }));

      const removed = checkpointer.purgeStale({
        olderThanMs: 30 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(2);
      await expect(checkpointer.load('conv-old-1')).resolves.toBeNull();
      await expect(checkpointer.load('conv-old-2')).resolves.toBeNull();
      await expect(checkpointer.load('conv-fresh')).resolves.not.toBeNull();

      db.close();
    });

    it('preserves rows with pending tool calls by default', async () => {
      const db = freshDb();
      const checkpointer = new SqliteCheckpointer(db);

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await checkpointer.save(
        'conv-stuck',
        createEngineState({
          nodeId: 'llm',
          local: {
            pendingToolCalls: [
              {
                id: ToolCallIdSchema.parse('t'),
                type: 'function',
                function: { name: 'x', arguments: '{}' },
              },
            ],
          },
        })
      );
      await checkpointer.save('conv-clean', createEngineState({ nodeId: 'answer' }));

      const removed = checkpointer.purgeStale({
        olderThanMs: 30 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(1);
      await expect(checkpointer.load('conv-stuck')).resolves.not.toBeNull();
      await expect(checkpointer.load('conv-clean')).resolves.toBeNull();

      db.close();
    });

    it('includePending=true forcibly removes pending rows too', async () => {
      const db = freshDb();
      const checkpointer = new SqliteCheckpointer(db);

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await checkpointer.save(
        'conv-stuck',
        createEngineState({
          nodeId: 'llm',
          local: {
            pendingToolCalls: [
              {
                id: ToolCallIdSchema.parse('t'),
                type: 'function',
                function: { name: 'x', arguments: '{}' },
              },
            ],
          },
        })
      );

      const removed = checkpointer.purgeStale({
        olderThanMs: 30 * 24 * 60 * 60 * 1000,
        includePending: true,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(1);
      await expect(checkpointer.load('conv-stuck')).resolves.toBeNull();

      db.close();
    });

    it('returns 0 when nothing matches', async () => {
      const db = freshDb();
      const checkpointer = new SqliteCheckpointer(db);

      vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'));
      await checkpointer.save('conv-fresh', createEngineState({ nodeId: 'llm' }));

      const removed = checkpointer.purgeStale({
        olderThanMs: 30 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(0);
      await expect(checkpointer.load('conv-fresh')).resolves.not.toBeNull();

      db.close();
    });
  });
});
