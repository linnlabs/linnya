import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createCanvasViewLifecycle } from '..';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, updateCanvasEditingClaim } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasPlainTextDocument } from '../../../../shared';

it('重载释放旧视图的撤销、guard与编辑保护，只在最后视图关闭时刷盘', () => {
  const database = new Database(':memory:');
  const failures: unknown[] = [], flushed: string[] = [];
  try {
    database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
    for (const migration of canvasPluginMigrations) migration.up(database);
    database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc');
    initializeCanvasDocument(database, 'doc');
    const history = createCanvasHistoryRuntime({ database });
    const lifecycle = createCanvasViewLifecycle({ closed(documentId, viewId, lastView) {
      history.releaseView(viewId);
      if (lastView) flushed.push(documentId);
    }, failed: error => failures.push(error) });
    const oldWindow = new AbortController(), newWindow = new AbortController();
    const oldContext = { rendererSessionId: 'old', signal: oldWindow.signal };
    lifecycle.register('doc', 'old-view', oldContext);
    lifecycle.register('doc', 'other-old-view', oldContext);
    lifecycle.register('doc', 'new-view', { rendererSessionId: 'new', signal: newWindow.signal });
    const actor = { source: { kind: 'user' as const, conversationId: null, runId: null }, viewId: 'old-view' };
    history.commit({ actor, now: 1, request: { documentId: 'doc', requestId: 'add', operations: [{ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('测试') }] } });
    history.commit({ actor, now: 2, request: { documentId: 'doc', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] } });
    updateCanvasEditingClaim(database, { documentId: 'doc', viewId: 'old-view', elementId: 'c1', fields: ['data'], now: 2 });
    expect(history.status('doc', 'old-view').canUndo).toBe(true);
    oldWindow.abort();
    expect(history.status('doc', 'old-view')).toEqual({ canUndo: false, canRedo: false });
    expect(database.prepare('SELECT count(*) AS n FROM canvas_editing_claims').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT count(*) AS n FROM canvas_history_guards').get()).toEqual({ n: 0 });
    expect(lifecycle.has('doc', 'old-view')).toBe(false);
    expect(lifecycle.has('doc', 'new-view')).toBe(true);
    expect(() => lifecycle.register('doc', 'late-old-view', oldContext)).toThrow();
    expect(flushed).toEqual([]);
    newWindow.abort();
    lifecycle.close('doc', 'new-view'); lifecycle.dispose();
    expect(flushed).toEqual(['doc']);
    expect(failures).toEqual([]);
  } finally { database.close(); }
});
