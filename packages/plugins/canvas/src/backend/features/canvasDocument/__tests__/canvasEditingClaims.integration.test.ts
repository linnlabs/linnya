import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, createCanvasPlainTextDocument } from '../../../../shared';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, replaceCanvasEditingClaims } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../../../renderer/features/canvasDocument';
import { readCanvasSnapshot } from '../../canvasCommit';

it('500卡共用一次领取与续约，owner释放及关闭不会被迟到续约覆盖', async () => {
  const database = new Database(':memory:');
  vi.useFakeTimers();
  try {
    database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
    for (const migration of canvasPluginMigrations) migration.up(database);
    database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc');
    initializeCanvasDocument(database, 'doc');
    const history = createCanvasHistoryRuntime({ database });
    const actor = { source: { kind: 'agent' as const, conversationId: 'chat', runId: 'run' }, viewId: 'agent' };
    history.commitAgent({ actor, now: Date.now(), request: { documentId: 'doc', requestId: 'add', operations: Array.from({ length: 500 }, () => ({
      op: 'addText', content: createCanvasPlainTextDocument('test'), width: 240, height: 120,
    })) } });
    const editing = vi.fn(async (input: Parameters<CanvasDocumentPort['editing']>[0]) => replaceCanvasEditingClaims(database, { ...input, now: Date.now() }));
    const session = createCanvasDocumentSession({ editing, read: async () => readCanvasSnapshot(database, 'doc'), changes: vi.fn(), commit: vi.fn(), undo: vi.fn(), subscribe: () => () => {}, close: async (_id, viewId) => history.releaseView(viewId) });
    await session.open('doc');
    const ids = Array.from({ length: 500 }, (_, index) => CanvasCardIdSchema.parse(`c${index + 1}`));
    await Promise.all(ids.map(id => session.protect(id, ['x', 'y'], 'drag')));
    expect(editing).toHaveBeenCalledTimes(1);
    expect(editing.mock.calls[0][0].claims).toHaveLength(500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(editing).toHaveBeenCalledTimes(2);
    const blocked = history.commitAgent({ actor, now: Date.now(), request: { documentId: 'doc', requestId: 'move', operations: ids.map(id => ({ op: 'update', id, baseRevision: 1, patch: { x: 100 } })) } });
    expect(blocked.commit?.results.every(result => result.status === 'skipped' && result.reason === 'user_editing')).toBe(true);
    await session.protect(ids[0], ['data'], 'text');
    await Promise.all(ids.map(id => session.protect(id, [], 'drag')));
    expect(editing.mock.calls.at(-1)?.[0].claims).toEqual([{ elementId: ids[0], fields: ['data'] }]);
    await session.protect(ids[0], [], 'text');
    const calls = editing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(editing).toHaveBeenCalledTimes(calls);
    const late = session.protect(ids[0], ['data'], 'late');
    await session.close(); await late;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(database.prepare('SELECT count(*) AS n FROM canvas_editing_claims').get()).toEqual({ n: 0 });
  } finally { vi.useRealTimers(); database.close(); }
}, 20_000);
