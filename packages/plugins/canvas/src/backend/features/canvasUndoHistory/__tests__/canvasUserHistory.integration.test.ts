import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, readCanvasSynchronization } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasPlainTextDocument } from '../../../../shared';

function fixture() {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const user = { source: { kind: 'user' as const, conversationId: null, runId: null }, viewId: 'view' };
  const commit = (operations: unknown[], extra: { historyGroupId?: string } = {}) => history.commit({ request: { documentId: 'doc', requestId: String(next++), operations }, actor: user, now: next, ...extra });
  const undo = (direction: 'undo' | 'redo' = 'undo', requestId = String(next++)) => history.undo({ documentId: 'doc', viewId: 'view', requestId, direction }, next);
  return { database, history, commit, undo, user, get elements() { return readCanvasSnapshot(database, 'doc').elements; } };
}
const add = { op: 'addText', content: createCanvasPlainTextDocument('Example'), width: 240, height: 120 };

describe('Canvas user undo and redo', () => {
  it('undoes successive edits twice and redoes actual inverse while versions increase', () => {
    const f = fixture(); f.commit([add]);
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }]);
    f.commit([{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'green' } }]);
    expect(f.undo().commit.results[0]?.status).toBe('applied'); expect(f.elements[0]).toMatchObject({ color: 'yellow', revision: 4 });
    f.undo(); expect(f.elements[0]).toMatchObject({ color: 'white', revision: 5 });
    f.undo('redo'); expect(f.elements[0]).toMatchObject({ color: 'yellow', revision: 6 });
    f.undo('redo'); expect(f.elements[0]).toMatchObject({ color: 'green', revision: 7 });
    f.database.close();
  });
  it('merges repeated automatic saves into one user step and excludes other views', () => {
    const f = fixture(); f.commit([add]);
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }], { historyGroupId: 'typing' });
    f.commit([{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'green' } }], { historyGroupId: 'typing' });
    f.undo(); expect(f.elements[0]).toMatchObject({ color: 'white' });
    expect(f.history.status('doc', 'another')).toEqual({ canUndo: false, canRedo: false }); f.database.close();
  });
  it('guards the exact history action, including all-skipped traversal without a sequence change', () => {
    const f = fixture(); const created = f.commit([add]);
    const edit = f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } }]);
    f.history.commitAgent({ request: { documentId: 'doc', requestId: 'foreign', operations: [{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'green' } }] }, actor: { source: { kind: 'agent', conversationId: 'A', runId: 'r' }, viewId: 'agent' }, now: 5 });
    const sequence = readCanvasSnapshot(f.database, 'doc').sequence;
    const request = { documentId: 'doc', viewId: 'view', requestId: 'guarded', direction: 'undo' as const, expectedActionId: edit.requestId };
    const skipped = f.history.undo(request, 6); expect(skipped.commit.results.every(result => result.status === 'skipped')).toBe(true);
    expect(skipped.commit.sequence).toBe(sequence);
    expect(() => f.history.undo({ ...request, requestId: 'stale-button' }, 7)).toThrow('canvas_history_head_changed');
    expect(f.history.undo(request, 8).commit).toEqual(skipped.commit);
    expect(() => f.history.undo({ ...request, requestId: 'actual-head', expectedActionId: created.requestId }, 9)).not.toThrow();
    f.database.close();
  });
  it('does not pop another entry when an undo response is retried', () => {
    const f = fixture(); f.commit([add]); f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } }]);
    const first = f.undo('undo', 'retry'); const second = f.undo('undo', 'retry');
    expect(first).toEqual(second); expect(f.elements).toHaveLength(1); f.database.close();
  });
  it('preserves later fields and only redoes the subset actually undone', () => {
    const f = fixture(); f.commit([add]); f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red', x: 40 } }]);
    f.history.commit({ request: { documentId: 'doc', requestId: 'agent', operations: [{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'green' } }] }, actor: { source: { kind: 'agent', conversationId: 'other', runId: 'run' }, viewId: 'agent' }, now: 5 });
    f.undo(); expect(f.elements[0]).toMatchObject({ color: 'green', x: 0 });
    f.undo('redo'); expect(f.elements[0]).toMatchObject({ color: 'green', x: 40 }); f.database.close();
  });
  it('restores deleted cards and edges with original IDs, then can undo the original creation', () => {
    const f = fixture(); f.commit([{ ...add, ref: '$a' }, { ...add, ref: '$b' }, { op: 'connect', from: '$a', to: '$b' }]);
    f.commit([{ op: 'delete', id: 'c1' }]); expect(f.elements).toHaveLength(1);
    f.undo(); expect(f.elements.map(element => element.id).sort()).toEqual(['c1', 'c2', 'e1']);
    f.undo(); expect(f.elements).toHaveLength(0); f.database.close();
  });
  it('preserves a new card once another source links to it and releases guards when the view exits', () => {
    const f = fixture(); f.commit([add]);
    f.history.commit({ request: { documentId: 'doc', requestId: 'agent', operations: [{ ...add, ref: '$b' }, { op: 'connect', from: 'c1', to: '$b' }] }, actor: { source: { kind: 'agent', conversationId: 'other', runId: 'run' }, viewId: 'agent' }, now: 5 });
    expect(f.undo().commit.results[0]?.status).toBe('skipped'); expect(f.elements).toHaveLength(3);
    f.commit([{ op: 'delete', id: 'c1' }]);
    f.history.releaseView('view'); expect(f.database.prepare('SELECT count(*) AS n FROM canvas_history_guards WHERE element_id = ?').get('c1')).toEqual({ n: 0 }); f.database.close();
  });
  it('keeps body field versions stale after undo restores the old logical origin, while style writes remain LWW', () => {
    const f = fixture(); f.commit([add]); f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('用户新正文') } } }]); f.undo();
    const actor = { source: { kind: 'agent' as const, conversationId: null, runId: null }, viewId: 'agent' };
    const result = f.history.commit({ request: { documentId: 'doc', requestId: 'stale', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('过期正文') } } }] }, actor, now: 5 });
    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'stale_field' }); expect(f.elements[0]).toMatchObject({ data: { content: createCanvasPlainTextDocument('Example') }, revision: 3 });
    const style = f.history.commit({ request: { documentId: 'doc', requestId: 'style', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } }] }, actor, now: 6 });
    expect(style.results[0]?.status).toBe('applied'); expect(f.elements[0]).toMatchObject({ color: 'green' }); f.database.close();
  });
  it('publishes trusted context after atomic participants and recovers synchronization gaps with a snapshot', () => {
    const f = fixture(); const seen: string[] = [];
    const history = createCanvasHistoryRuntime({ database: f.database, ports: { participants: [{ commit(_plan, context) { expect(f.database.inTransaction).toBe(true); seen.push(context.documentId); } }], publish(_plan, context) { expect(f.database.inTransaction).toBe(false); seen.push(context.requestId); } } });
    history.commit({ request: { documentId: 'doc', requestId: 'context', operations: [add] }, actor: f.user, now: 1 });
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }]);
    expect(seen).toEqual(['doc', 'context']); expect(readCanvasSynchronization(f.database, { documentId: 'doc', afterSequence: 0 })).toMatchObject({ kind: 'delta', sequence: 2 });
    f.database.prepare('DELETE FROM canvas_changes WHERE sequence = 1').run();
    expect(readCanvasSynchronization(f.database, { documentId: 'doc', afterSequence: 0 })).toMatchObject({ kind: 'snapshot', snapshot: { sequence: 2 } }); f.database.close();
  });
  it('does not change the undo stack after a failed atomic participant', () => {
    const f = fixture(); const broken = createCanvasHistoryRuntime({ database: f.database, ports: { participants: [{ commit() { throw new Error('index failed'); } }] } });
    expect(() => broken.commit({ request: { documentId: 'doc', requestId: 'fail', operations: [add] }, actor: f.user, now: 1 })).toThrow('index failed');
    expect(broken.status('doc', 'view')).toEqual({ canUndo: false, canRedo: false }); expect(f.elements).toHaveLength(0); f.database.close();
  });
});

it('records trusted restoration as one undoable user action and sends undo/redo to durable history hooks', async () => {
  const { planCanvasCommit } = await import('../../canvasCommit');
  const f = fixture(); const changes: number[] = [];
  const history = createCanvasHistoryRuntime({ database: f.database, ports: { history(input) {
    expect(f.database.inTransaction).toBe(true); changes.push(input.plan.state.sequence); return undefined;
  } } });
  history.commit({ request: { documentId: 'doc', requestId: 'create', operations: [add] }, actor: f.user, now: 1 });
  history.transition({ documentId: 'doc', requestId: 'restore', payload: { kind: 'versionRestore', versionId: 'v1' }, actor: f.user, now: 2,
    buildPlan: (state, claims, origin) => planCanvasCommit({ state, claims, origin, actor: f.user, now: 2, operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }] }) });
  history.undo({ documentId: 'doc', viewId: 'view', requestId: 'undo-restore', direction: 'undo' }, 3);
  expect(f.elements[0]).toMatchObject({ color: 'white' });
  history.undo({ documentId: 'doc', viewId: 'view', requestId: 'redo-restore', direction: 'redo' }, 4);
  expect(f.elements[0]).toMatchObject({ color: 'yellow' });
  expect(changes).toEqual([1, 2, 3, 4]);
  f.database.close();
});
