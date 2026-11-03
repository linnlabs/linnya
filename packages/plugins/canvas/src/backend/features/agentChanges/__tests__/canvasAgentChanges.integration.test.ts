import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, type CanvasCommitActor } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { readCanvasAgentGroups, saveCanvasAgentGroup } from '..';
import { createCanvasPlainTextDocument, type CanvasAgentCommitResult } from '../../../../shared';

const add = { op: 'addText', content: createCanvasPlainTextDocument('Example'), width: 240, height: 120 };
function fixture() {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  let history = createCanvasHistoryRuntime({ database }); let next = 0;
  const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
  const agent = (conversationId: string | null, runId = 'run'): CanvasCommitActor => ({ source: { kind: 'agent', conversationId, runId }, viewId: `agent-${runId}` });
  const commit = (operations: unknown[]) => history.commit({ request: { documentId: 'doc', requestId: `u${next++}`, operations }, actor: user, now: next });
  const apply = (conversation: string | null, operations: unknown[], requestId = `a${next++}`, runId = 'run') => history.commitAgent({ request: { documentId: 'doc', requestId, operations }, actor: agent(conversation, runId), now: next });
  const withdraw = (groupId: string) => history.withdraw({ documentId: 'doc', groupId, requestId: `w${next++}`, viewId: 'view' }, next);
  const resolve = (value: CanvasAgentCommitResult, decision: 'allow' | 'deny' = 'allow') => { if (value.kind !== 'pending') throw new Error('expected pending'); return history.resolveApproval({ documentId: 'doc', viewId: 'view', requestId: `r${next++}`, pendingId: value.approval.id, decision }, next); };
  return { database, commit, apply, withdraw, resolve, get history() { return history; }, restart() { history = createCanvasHistoryRuntime({ database }); }, get elements() { return readCanvasSnapshot(database, 'doc').elements; } };
}
const update = (color: string, baseRevision: number) => [{ op: 'update', id: 'c1', baseRevision, patch: { color } }];

describe('Canvas durable Agent change groups', () => {
  it('persists skipped operations and actual changed fields without inventing a new write or duplicate retry', () => {
    const f = fixture(); f.commit([add]); f.apply('A', update('yellow', 1), 'success');
    const first = f.history.listGroups('doc', 10000)[0]; if (!first) throw new Error('missing group');
    expect(first.changes).toEqual([{ id: 'c1', kind: 'updated', fields: ['color'] }]);
    f.apply('A', update('red', 0), 'stale'); f.apply('A', update('red', 0), 'stale');
    const group = f.history.listGroups('doc', 10000)[0];
    expect(group?.lastWriteAt).toBe(first.lastWriteAt); expect(group?.writing).toBe(false);
    expect(group?.outcomes).toEqual({ complete: true, skippedWrites: [{ requestId: 'stale', index: 0, id: 'c1', reason: 'stale_field', fields: ['color'] }] });
    f.restart(); expect(f.history.listGroups('doc', 10000)[0]?.outcomes).toEqual(group?.outcomes); f.database.close();
  });
  it('does not turn missing legacy outcome facts into a claim that no operations were skipped', () => {
    const f = fixture(); f.apply('A', [add]); const stored = readCanvasAgentGroups(f.database, 'doc')[0]; if (!stored) throw new Error('missing group');
    expect(stored.outcomes?.complete).toBe(true); saveCanvasAgentGroup(f.database, { ...stored, outcomes: undefined });
    const group = f.history.listGroups('doc', 10000)[0]; expect(group?.outcomes).toEqual({ complete: false, skippedWrites: [] });
    f.apply('A', update('red', 0)); expect(f.history.listGroups('doc', 10000)[0]?.outcomes.complete).toBe(false); f.database.close();
  });
  it('does not create a ghost or obstacle for an Agent card created and removed within the same group', () => {
    const f = fixture(); f.history.registerView({ documentId: 'doc', viewId: 'view' });
    f.apply('A', [add]); f.apply('A', [{ op: 'delete', id: 'c1' }]);
    const group = f.history.listGroups('doc', 10000, 'view')[0];
    expect(group).toMatchObject({ added: [], updated: [], deleted: [], changes: [], deletedCards: [], visibleDeletedCards: [] });
    const preview = f.history.preview({ request: { documentId: 'doc', requestId: 'next', operations: [add] }, actor: { source: { kind: 'agent', conversationId: 'B', runId: 'b' }, viewId: 'b' }, now: 10001 });
    expect(preview.changes[0]?.after).toMatchObject({ x: 0, y: 0 }); f.database.close();
  });
  it('keeps layout-only changes withdrawable without counting them as content review markers', () => {
    const f = fixture(); f.commit([add]); f.apply('A', [{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 40 } }]);
    const group = f.history.listGroups('doc', 10000)[0]; if (!group) throw new Error('missing group');
    expect(group.changes).toEqual([]); expect(group.updated).toEqual([]);
    f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ x: 0 }); f.database.close();
  });
  it('retains the intervening B value when A writes again, and redo only replays the actual withdrawal', () => {
    const f = fixture(); f.commit([add]); f.apply('A', update('yellow', 1)); f.apply('B', update('green', 2)); f.apply('A', update('red', 3));
    const group = f.history.listGroups('doc', 1).find(group => group.conversationId === 'A'); if (!group) throw new Error('missing group');
    f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ color: 'green', revision: 5 });
    f.history.undo({ documentId: 'doc', viewId: 'view', requestId: 'redo-withdrawal', direction: 'undo' }, 10); expect(f.elements[0]).toMatchObject({ color: 'red', revision: 6 });
    expect(f.history.listGroups('doc', 4000).every(group => !group.writing)).toBe(true); f.database.close();
  });
  it('does not capture unrelated foreign fields while merging another field, and preserves later user writes', () => {
    const f = fixture(); f.commit([add]); f.apply('A', [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow', x: 10 } }]); f.apply('B', update('green', 2));
    f.apply('A', [{ op: 'update', id: 'c1', baseRevision: 3, patch: { x: 20 } }]);
    const group = f.history.listGroups('doc', 1).find(group => group.conversationId === 'A'); if (!group) throw new Error('missing group');
    f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ color: 'green', x: 0 });
    f.apply('A', update('red', 5)); f.commit(update('purple', 6)); f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ color: 'purple' }); f.database.close();
  });
  it('keeps an Agent creation completely unchanged after another source edits or links it', () => {
    const f = fixture(); f.apply('A', [add]); f.apply('B', update('green', 1)); f.apply('A', [{ op: 'update', id: 'c1', baseRevision: 2, patch: { x: 20 } }]);
    const group = f.history.listGroups('doc', 1).find(group => group.conversationId === 'A'); if (!group) throw new Error('missing group');
    f.apply('A', update('red', 3)); f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ color: 'red', x: 20 }); f.database.close();
  });
  it('survives reload and 512-row journal trimming, then releases group-only deletion guards on completion', () => {
    const f = fixture(); f.commit([add, add]); f.apply('A', [{ op: 'delete', id: 'c1' }]);
    for (let i = 0; i < 513; i++) f.apply('B', [{ op: 'update', id: 'c2', baseRevision: i + 1, patch: { color: i % 2 ? 'yellow' : 'green' } }]);
    expect(f.database.prepare('SELECT count(*) AS n FROM canvas_changes').get()).toEqual({ n: 512 });
    f.restart(); const group = f.history.listGroups('doc', 1).find(group => group.conversationId === 'A'); if (!group) throw new Error('missing group');
    f.withdraw(group.id); expect(f.elements.some(element => element.id === 'c1')).toBe(true);
    f.apply('A', [{ op: 'delete', id: 'c1' }]); f.history.releaseView('view'); f.history.closeGroup({ documentId: 'doc', groupId: group.id });
    expect(f.database.prepare('SELECT count(*) AS n FROM canvas_history_guards').get()).toEqual({ n: 0 }); f.database.close();
  });
  it('groups child runs by conversation and makes request retries independent of run and view', () => {
    const f = fixture(); const first = f.apply('A', [add], 'same', 'parent'); expect(f.apply('A', [add], 'same', 'child')).toEqual(first);
    expect(() => f.apply('A', [{ ...add, color: 'green' }], 'same', 'child')).toThrow('request_id_payload_mismatch');
    f.apply('A', [add], 'second', 'child'); f.apply(null, [add]);
    expect(f.history.listGroups('doc', 1).find(group => group.conversationId === 'A')?.runIds).toEqual(['parent', 'child']); expect(f.elements).toHaveLength(3); f.database.close();
  });
  it('cumulates small deletion batches, rechecks the exact pending objects, and makes approval retry idempotent', () => {
    const f = fixture(); f.commit(Array.from({ length: 22 }, () => add));
    f.apply('A', Array.from({ length: 19 }, (_, i) => ({ op: 'delete', id: `c${i + 1}` })));
    const pending = f.apply('A', [{ op: 'delete', id: 'c20' }, { op: 'delete', id: 'c21' }], 'pending'); expect(pending.kind).toBe('pending'); expect(f.elements).toHaveLength(3);
    f.commit([{ op: 'update', id: 'c20', baseRevision: 1, patch: { color: 'green' } }]);
    const result = f.resolve(pending); expect(result.kind).toBe('committed'); expect(f.elements.map(element => element.id)).toEqual(['c20', 'c22']); expect(f.resolve(pending)).toEqual(result);
    expect(f.apply('A', [{ op: 'delete', id: 'c20' }, { op: 'delete', id: 'c21' }], 'pending')).toEqual(result); f.database.close();
  });
  it('replays raw CLI append identity before re-normalizing the now-changed content', () => {
    const f = fixture(); f.commit([add]); const actor: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'A', runId: 'first' }, viewId: 'agent-first' };
    const payloadIdentity = { operations: [{ op: 'append', id: 'c1', markdown: 'more' }], options: { dryRun: false } };
    const request = { documentId: 'doc', requestId: 'append', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('Example more') } } }] };
    const first = f.history.commitAgent({ request, actor, now: 1, payloadIdentity });
    const second = f.history.replayAgentRequest({ documentId: 'doc', requestId: 'append', actor: { ...actor, viewId: 'agent-child', source: { ...actor.source, runId: 'child' } }, payloadIdentity }); expect(second).toEqual(first);
    expect(f.history.commitAgent({ request: { ...request, operations: [{ op: 'update', id: 'c1', baseRevision: 2, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('Example more more') } } }] }, actor, now: 2, payloadIdentity })).toEqual(first);
    expect(f.elements[0]).toMatchObject({ revision: 2, data: { content: createCanvasPlainTextDocument('Example more') } });
    expect(() => f.history.replayAgentRequest({ documentId: 'doc', requestId: 'append', actor, payloadIdentity: { operations: [{ op: 'append', id: 'c1', markdown: 'different' }] } })).toThrow('request_id_payload_mismatch'); f.database.close();
  });
  it('replays pending and approval outcomes with the original raw request identity', () => {
    const f = fixture(); f.commit(Array.from({ length: 20 }, () => add)); const actor: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'A', runId: 'run' }, viewId: 'agent' };
    const payloadIdentity = { operation: 'deleteMany', count: 20 };
    const pending = f.history.commitAgent({ request: { documentId: 'doc', requestId: 'raw-pending', operations: Array.from({ length: 20 }, (_, i) => ({ op: 'delete', id: `c${i + 1}` })) }, actor, now: 1, payloadIdentity });
    expect(f.history.replayAgentRequest({ documentId: 'doc', requestId: 'raw-pending', actor, payloadIdentity })).toEqual(pending); f.resolve(pending, 'deny');
    expect(() => f.history.replayAgentRequest({ documentId: 'doc', requestId: 'raw-pending', actor, payloadIdentity })).toThrow('canvas_approval_denied');
    expect(f.history.approvalResults('doc', 'A')[0]).toMatchObject({ requestId: 'raw-pending', status: 'denied', commit: null }); f.database.close();
  });
  it('retains durable group identity through a real SQLite close and reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-groups-')); const filename = join(directory, 'workspace.db');
    let database = new Database(filename);
    try {
      database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)'); for (const migration of canvasPluginMigrations) migration.up(database);
      database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
      const first = createCanvasHistoryRuntime({ database });
      first.commit({ request: { documentId: 'doc', requestId: 'add', operations: [add] }, actor: { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' }, now: 1 });
      first.commitAgent({ request: { documentId: 'doc', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] }, actor: { source: { kind: 'agent', conversationId: 'deleted-chat', runId: 'child' }, viewId: 'agent' }, now: 2 });
      database.close(); database = new Database(filename); database.pragma('foreign_keys = ON'); const second = createCanvasHistoryRuntime({ database });
      const group = second.listGroups('doc', 5000)[0]; if (!group) throw new Error('missing group');
      second.withdraw({ documentId: 'doc', viewId: 'new-view', requestId: 'withdraw', groupId: group.id }, 5001); expect(readCanvasSnapshot(database, 'doc').elements[0]?.id).toBe('c1');
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('keeps a pending batch and its counters intact when an approval participant rolls back', () => {
    const f = fixture(); f.commit(Array.from({ length: 20 }, () => add)); const pending = f.apply('A', Array.from({ length: 20 }, (_, i) => ({ op: 'delete', id: `c${i + 1}` })));
    if (pending.kind !== 'pending') throw new Error('expected pending');
    const broken = createCanvasHistoryRuntime({ database: f.database, ports: { history() { throw new Error('retention failed'); } } });
    expect(() => broken.resolveApproval({ documentId: 'doc', viewId: 'view', requestId: 'allow', pendingId: pending.approval.id, decision: 'allow' }, 10)).toThrow('retention failed');
    expect(f.elements).toHaveLength(20); expect(f.history.listGroups('doc', 10)[0]?.pendingApproval?.id).toBe(pending.approval.id); f.resolve(pending); expect(f.elements).toHaveLength(0); f.database.close();
  });
  it('hides reviewed markers without discarding withdrawal and marks later Agent edits again', () => {
    const f = fixture(); f.apply('A', [add]); const group = f.history.listGroups('doc', 1)[0]; if (!group) throw new Error('missing group'); const id = group.added[0]; if (!id) throw new Error('missing card');
    f.history.reviewElement({ documentId: 'doc', elementId: id }); expect(f.history.listGroups('doc', 1)[0]?.reviewedElementIds).toEqual([id]);
    f.apply('A', update('green', 1)); expect(f.history.listGroups('doc', 1)[0]?.reviewedElementIds).toEqual([]); f.commit(update('yellow', 2)); expect(f.history.listGroups('doc', 1)[0]?.reviewedElementIds).toEqual([id]);
    f.withdraw(group.id); expect(f.elements[0]).toMatchObject({ color: 'yellow' }); f.database.close();
  });
  it('reserves only deletion outlines visible in an open view and reopens without hidden obstacles', () => {
    const f = fixture(); f.commit([add]); f.history.registerView({ documentId: 'doc', viewId: 'view' }); f.apply('A', [{ op: 'delete', id: 'c1' }]);
    f.history.registerView({ documentId: 'doc', viewId: 'view' });
    expect(f.history.listGroups('doc', 1, 'view')[0]?.visibleDeletedCards).toHaveLength(1); expect(f.history.listGroups('doc', 1)[0]?.visibleDeletedCards).toHaveLength(0);
    const actor: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'B', runId: 'run' }, viewId: 'agent' };
    const preview = () => f.history.preview({ request: { documentId: 'doc', requestId: 'preview', operations: [add] }, actor, now: 10 });
    expect(preview().changes[0]?.after).toMatchObject({ x: 272 });
    f.history.releaseView('view'); f.history.registerView({ documentId: 'doc', viewId: 'view' }); expect(f.history.listGroups('doc', 1, 'view')[0]?.visibleDeletedCards).toHaveLength(0);
    expect(preview().changes[0]?.after).toMatchObject({ x: 0 }); f.database.close();
  });
  it('restores a deleted card near its old position if a later card occupies it and skips duplicate connections', () => {
    const f = fixture(); f.commit([add, add, { op: 'connect', from: 'c1', to: 'c2' }]); f.apply('A', [{ op: 'delete', id: 'e1' }]); f.apply('B', [{ op: 'connect', from: 'c1', to: 'c2' }]);
    const lineGroup = f.history.listGroups('doc', 1).find(group => group.conversationId === 'A'); if (!lineGroup) throw new Error('missing group');
    expect(f.withdraw(lineGroup.id).commit.results[0]?.status).toBe('skipped'); expect(f.elements.filter(element => element.type === 'edge')).toHaveLength(1);
    f.apply('A', [{ op: 'delete', id: 'c1' }]); f.commit([{ ...add, x: 0, y: 0 }]);
    const result = f.withdraw(lineGroup.id); expect(result.commit.results.some(row => row.reason === 'restored_nearby')).toBe(true);
    const restored = f.elements.find(element => element.id === 'c1'); expect(restored && 'x' in restored && (restored.x !== 0 || restored.y !== 0)).toBe(true); f.database.close();
  });
  it('requires effective whole-canvas movement and clears replaced, denied, withdrawn or closed approval batches', () => {
    const f = fixture(); f.commit(Array.from({ length: 22 }, () => add));
    const moves = Array.from({ length: 20 }, (_, i) => ({ op: 'update', id: `c${i + 1}`, baseRevision: 1, patch: { y: 900 } }));
    const first = f.apply('A', moves, 'first'); expect(first.kind).toBe('pending'); const second = f.apply('A', moves, 'second');
    expect(() => f.resolve(first)).toThrow('canvas_approval_expired'); expect(f.resolve(second, 'deny')).toEqual({ kind: 'denied' }); expect(f.elements[0]).toMatchObject({ y: 0 });
    expect(() => f.apply('A', moves, 'second')).toThrow('canvas_approval_denied');
    const third = f.apply('A', moves, 'third'); if (third.kind !== 'pending') throw new Error('expected pending'); f.withdraw(third.approval.groupId); expect(() => f.resolve(third)).toThrow('canvas_approval_expired');
    const fourth = f.apply('A', moves, 'fourth'); if (fourth.kind !== 'pending') throw new Error('expected pending'); f.history.closeGroup({ documentId: 'doc', groupId: fourth.approval.groupId }); expect(() => f.resolve(fourth)).toThrow('canvas_approval_expired'); f.database.close();
  });
});
