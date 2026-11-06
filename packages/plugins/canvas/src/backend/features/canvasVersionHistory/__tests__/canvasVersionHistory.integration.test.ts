import type { DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { initializeCanvasDocument, readCanvasCommitState, planCanvasCommit, type CanvasCommitActor } from '../../canvasCommit';
import { collectCanvasAssetIds } from '../../canvasDocument';
import { createCanvasPlainTextDocument, type CanvasSnapshot } from '../../../../shared';
import { createCanvasVersionHistoryRuntime } from '../index';
import { decodeCanvasVersionInverse } from '../functions/canvasVersionCodec';

const fixtures: ReturnType<typeof fixture>[] = [], directories: string[] = [];
const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
const add = { op: 'addText', content: createCanvasPlainTextDocument('A long body that moving a card must not duplicate.'), width: 240, height: 120 };
function fixture(filename = ':memory:', budgetBytes?: number) {
  const database = new Database(filename); database.pragma('foreign_keys = ON');
  if (!database.prepare("SELECT name FROM sqlite_master WHERE name = 'canvas_documents'").get()) {
    database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc')");
    for (const migration of canvasPluginMigrations) migration.up(database);
    initializeCanvasDocument(database, 'doc');
  }
  const snapshot = (): CanvasSnapshot => { const state = readCanvasCommitState(database, 'doc'); return { schemaVersion: 1, documentId: 'doc', sequence: state.sequence, elements: state.elements.map(row => row.element) }; };
  const readCurrent = vi.fn(snapshot);
  const facts = new Map<string, number>(), failures = vi.fn(), reconcile = vi.fn(); let notificationFailure = false; let releaseFailure = false, crashed = false; let restoredFrom: DocumentVersionSummary['restoredFrom'];
  let editing: ReturnType<typeof createCanvasHistoryRuntime>;
  const versions = createCanvasVersionHistoryRuntime({ database, budgetBytes, ports: {
    readSnapshot: readCurrent,
    protectedAssetIds: () => collectCanvasAssetIds([...snapshot().elements, ...editing.retainedElements('doc')]),
    assetByteFacts: (_documentId, assetIds) => assetIds.map(assetId => { const byteLength = facts.get(assetId); if (byteLength === undefined) throw new Error('Missing byte fact'); return { assetId, byteLength }; }),
    reconcileHistoryAssets: (_documentId, assetIds) => { if (releaseFailure) throw new Error('Ownership failed'); reconcile(assetIds); }, reportFailure: failures, budgetChanged() { if (notificationFailure) throw new Error('Broadcast failed'); },
  } });
  editing = createCanvasHistoryRuntime({ database,
    groupStarted({ documentId, before, now }) { versions.checkpoint({ documentId, reason: 'agent-group', now, snapshot: { schemaVersion: 1, documentId, sequence: before.sequence, elements: before.elements.map(row => row.element) } }); },
    ports: { history(input) {
    expect(database.inTransaction).toBe(true); const afterCommit = versions.recordCommit(input);
    if (restoredFrom) versions.checkpoint({ documentId: 'doc', reason: 'restore', snapshot: { schemaVersion: 1, documentId: 'doc', sequence: input.plan.state.sequence, elements: input.plan.state.elements.map(row => row.element) }, restoredFrom });
    return afterCommit;
  } } });
  versions.initialize('doc', Date.now());
  function commit(operations: unknown[], options: { actor?: CanvasCommitActor } = {}) {
    return editing.commit({ request: { documentId: 'doc', requestId: randomUUID(), operations }, actor: options.actor ?? user, now: Date.now() });
  }
  function update(patch: unknown) { const current = snapshot().elements.find(element => element.id === 'c1'); if (!current) throw new Error('Missing c1'); return commit([{ op: 'update', id: 'c1', baseRevision: current.revision, patch }]); }
  function checkpoint() { return versions.checkpoint({ documentId: 'doc', reason: 'close' }); }
  function restore(request: DocumentVersionRestoreRequest) {
    const prepared = versions.prepareRestore(request); restoredFrom = { versionId: prepared.target.versionId, createdAt: prepared.target.createdAt };
    try { return editing.transition({ documentId: 'doc', requestId: randomUUID(), payload: { kind: 'restore', versionId: request.versionId }, actor: user, now: Date.now(), buildPlan(state, claims, origin) {
      versions.assertCurrent(request);
      const current = state.elements.find(row => row.element.id === 'c1')?.element, target = prepared.snapshot.elements.find(element => element.id === 'c1');
      if (!current || current.type === 'edge' || !target || target.type === 'edge') throw new Error('Expected c1 card');
      return { ...planCanvasCommit({ state, claims, origin, actor: user, now: Date.now(), operations: [{ op: 'update', id: 'c1', baseRevision: current.revision, patch: { x: target.x, color: target.color } }] }), retainedElements: prepared.snapshot.elements };
    } }); } finally { restoredFrom = undefined; }
  }
  function crash() { crashed = true; database.close(); vi.clearAllTimers(); }
  const value = { database, versions, editing, facts, failures, reconcile, readCurrent, snapshot, commit, update, checkpoint, restore, crash, failNotification: () => { notificationFailure = true; }, failRelease: () => { releaseFailure = true; }, get crashed() { return crashed; } };
  fixtures.push(value); return value;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { for (const value of fixtures.splice(0)) if (!value.crashed) { value.versions.dispose(); value.database.close(); } vi.useRealTimers(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('Canvas durable reverse-field version history', () => {
  it('does not reconstruct snapshots when retention keeps every version under budget', () => {
    const f = fixture(); f.commit([add]); f.checkpoint(); f.update({ x: 50 }); f.checkpoint();
    const before = f.versions.list('doc'); f.readCurrent.mockClear();
    const queries = vi.spyOn(f.database, 'prepare');
    expect(f.versions.compact('doc').overBudgetBytes).toBe(0);
    expect(f.readCurrent).not.toHaveBeenCalled();
    expect(queries.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO canvas_versions'))).toBe(false);
    queries.mockRestore();
    expect(f.versions.list('doc')).toEqual(before);
    expect(f.versions.preview('doc', before[1].versionId).elements[0]).toMatchObject({ x: 0 });
  });
  it('does not duplicate body JSON for moves, replays old states, records undo/redo and rejects stale restores', () => {
    const f = fixture(); f.commit([add]); f.checkpoint(); const first = f.versions.list('doc')[0];
    f.update({ x: 100 });
    const pending = f.database.prepare('SELECT reverse_blob FROM canvas_version_heads WHERE node_id = ?').get('doc');
    const blob = pending && typeof pending === 'object' && 'reverse_blob' in pending ? pending.reverse_blob : null;
    if (!(blob instanceof Uint8Array)) throw new Error('Missing inverse');
    const inverse = decodeCanvasVersionInverse(blob); expect(JSON.stringify(inverse)).not.toContain('A long body'); expect(inverse[0]).toMatchObject({ kind: 'patch', fields: { x: 0 } });
    const live = f.versions.list('doc')[0]; expect(live.versionId).not.toBe(first.versionId); expect(f.versions.preview('doc', first.versionId).elements[0]).toMatchObject({ x: 0 });
    f.checkpoint(); expect(f.versions.list('doc')[0].versionId).toBe(live.versionId);
    f.editing.undo({ documentId: 'doc', viewId: 'view', requestId: randomUUID(), direction: 'undo' }, Date.now()); f.checkpoint();
    expect(f.snapshot().elements[0]).toMatchObject({ x: 0 }); expect(f.versions.list('doc')[0].versionId).not.toBe(live.versionId);
    f.editing.undo({ documentId: 'doc', viewId: 'view', requestId: randomUUID(), direction: 'redo' }, Date.now());
    expect(() => f.versions.prepareRestore({ documentId: 'doc', versionId: first.versionId, expectedCurrentVersionId: live.versionId })).toThrow('version_conflict');
  });
  it('checkpoints exactly before an Agent group writes, using history.before even though current SQL was already updated', () => {
    const f = fixture(); f.commit([add]); const before = f.snapshot();
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }], { actor: { source: { kind: 'agent', conversationId: 'conversation', runId: 'run' }, viewId: 'agent' } });
    const prior = f.versions.list('doc').find(row => row.order === before.sequence + 1); if (!prior) throw new Error('No pre-Agent checkpoint');
    expect(f.versions.preview('doc', prior.versionId)).toEqual(before); expect(f.snapshot().elements[0]).toMatchObject({ color: 'yellow' });
  });
  it('persists uncheckpointed inverse state across SQLite reopen and flushes after thirty idle seconds', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'canvas-versions-')); directories.push(directory); const filename = path.join(directory, 'canvas.sqlite');
    const first = fixture(filename); first.commit([add]); first.checkpoint(); const old = first.versions.list('doc')[0]; first.update({ color: 'green' }); first.crash();
    const reopened = fixture(filename); expect(reopened.versions.preview('doc', old.versionId).elements[0]).toMatchObject({ color: 'white' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reopened.database.prepare('SELECT dirty_since FROM canvas_version_heads WHERE node_id = ?').get('doc')).toEqual({ dirty_since: null });
    expect(reopened.versions.preview('doc', reopened.versions.list('doc')[0].versionId)).toEqual(reopened.snapshot());
  });
  it('does not postpone continuous edits beyond ten minutes and retains the latest five under a soft asset budget', async () => {
    const f = fixture(undefined, 100 * 1024 * 1024); f.commit([add]);
    for (let index = 0; index < 24; index += 1) { await vi.advanceTimersByTimeAsync(25_000); f.update({ x: index + 1 }); }
    const count = f.database.prepare('SELECT COUNT(*) AS count FROM canvas_versions').get(); expect(count).toEqual({ count: 2 });
    f.versions.close('doc');
    const images = fixture(undefined, 100 * 1024 * 1024);
    for (let index = 0; index < 7; index += 1) {
      const assetId = `asset-${index}`; images.facts.set(assetId, 40 * 1024 * 1024);
      if (!index) images.commit([{ op: 'addImage', width: 240, height: 120, data: { assetId, caption: '', alt: '', crop: null } }]);
      else images.update({ data: { assetId, caption: '', alt: '', crop: null } });
      images.checkpoint();
    }
    images.editing.releaseView('view'); const status = images.versions.compact('doc');
    expect(images.versions.list('doc')).toHaveLength(5); expect(status.overBudgetBytes).toBeGreaterThan(0);
    for (const row of images.versions.list('doc')) expect(images.versions.preview('doc', row.versionId).elements).toHaveLength(1);
  });
  it('deletes thinned versions while uncheckpointed edits are pending, keeping the chain valid', () => {
    const f = fixture(); const at = (ms: number) => vi.setSystemTime(1_000_000 + ms);
    at(7_000); f.commit([add]); f.checkpoint();
    at(136_000); f.update({ x: 10 }); f.checkpoint();
    for (let index = 1; index <= 3; index++) { at(2 * 60 * 60_000 + index * 60_000); f.update({ x: 10 + index }); f.checkpoint(); }
    // 头上还有未封存的修改：保留列表多出“当前”一行，曾与已封存记录数恰好相等而漏删被裁掉的版本。
    at(2 * 60 * 60_000 + 10 * 60_000); f.update({ x: 99 });
    const before = f.versions.list('doc').map(row => row.versionId);
    const rows = f.database.prepare('SELECT * FROM canvas_versions').all();
    f.versions.compact('doc');
    const after = f.versions.list('doc').map(row => row.versionId);
    expect(after.length).toBeLessThan(before.length);
    expect(() => f.versions.compact('doc')).not.toThrow();
    for (const row of f.versions.list('doc')) expect(f.versions.preview('doc', row.versionId).sequence).toBe(row.order - 1);
    // 旧版漏删留下的链外记录：链本身有效时维护将其删除，而不是每次都以 version_corrupt 失败。
    const insert = f.database.prepare('INSERT OR IGNORE INTO canvas_versions VALUES (@node_id, @version_id, @sequence, @created_at, @schema_version, @previous_version_id, @state_hash, @reverse_blob, @anchor_blob, @asset_ids_json, @restored_from_json)');
    for (const row of rows) insert.run(row);
    expect(f.versions.list('doc').length).toBe(before.length);
    expect(() => f.versions.compact('doc')).not.toThrow();
    expect(f.versions.list('doc').map(row => row.versionId)).toEqual(after);
  });
  it('counts a shared historical asset once, atomically rolls back prune/ownership failure, and keeps sparse chains replayable', () => {
    const f = fixture(undefined, 64 * 1024 * 1024); f.facts.set('shared', 50 * 1024 * 1024); f.facts.set('current', 1024);
    f.commit([{ op: 'addImage', width: 240, height: 120, data: { assetId: 'shared', caption: '0', alt: '', crop: null } }]); f.checkpoint();
    for (let index = 1; index < 9; index += 1) { f.update({ data: { assetId: index === 8 ? 'current' : 'shared', caption: String(index), alt: '', crop: null } }); f.checkpoint(); }
    f.editing.releaseView('view'); const before = f.versions.list('doc').map(row => row.versionId); f.failRelease();
    expect(() => f.versions.compact('doc')).toThrow('Ownership failed'); expect(f.versions.list('doc').map(row => row.versionId)).toEqual(before);
    const clean = fixture(undefined, 64 * 1024 * 1024); clean.facts.set('shared', 50 * 1024 * 1024); clean.facts.set('current', 1024);
    clean.commit([{ op: 'addImage', width: 240, height: 120, data: { assetId: 'shared', caption: '0', alt: '', crop: null } }]); clean.checkpoint();
    for (let index = 1; index < 9; index += 1) { clean.update({ data: { assetId: index === 8 ? 'current' : 'shared', caption: String(index), alt: '', crop: null } }); clean.checkpoint(); }
    clean.editing.releaseView('view'); const status = clean.versions.compact('doc');
    expect(status.usedBytes).toBeGreaterThan(50 * 1024 * 1024); expect(status.usedBytes).toBeLessThan(51 * 1024 * 1024);
    for (const row of clean.versions.list('doc')) expect(clean.versions.preview('doc', row.versionId).sequence).toBe(row.order - 1);
  });
  it('detects damaged deltas before pruning and rejects a readonly display projection as history truth', () => {
    const f = fixture(); f.commit([add]); f.checkpoint();
    for (let index = 1; index <= 12; index++) { f.update({ x: index * 50 }); f.checkpoint(); }
    const before = f.versions.list('doc').map(row => row.versionId);
    f.database.prepare('UPDATE canvas_versions SET reverse_blob = ? WHERE version_id = ?').run(Buffer.from('damaged'), 'canvas-version:2');
    expect(() => f.versions.compact('doc')).toThrow('version_corrupt'); expect(f.versions.list('doc').map(row => row.versionId)).toEqual(before);
    const display = { ...f.snapshot(), integrity: { readOnly: true } };
    expect(() => f.versions.checkpoint({ documentId: 'doc', reason: 'close', snapshot: display })).toThrow('history_unavailable');
  });
  it('restores as one user action with same-transaction provenance, keeps Agent groups, and supports undo/redo', () => {
    const f = fixture(); f.commit([add]); f.checkpoint(); const target = f.versions.list('doc')[0];
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 100, color: 'yellow' } }], { actor: { source: { kind: 'agent', conversationId: 'agent', runId: 'run' }, viewId: 'agent' } });
    f.restore({ documentId: 'doc', versionId: target.versionId, expectedCurrentVersionId: f.versions.list('doc')[0].versionId });
    expect(f.snapshot().elements[0]).toMatchObject({ x: 0, color: 'white' }); expect(f.versions.list('doc')[0].restoredFrom).toEqual({ versionId: target.versionId, createdAt: target.createdAt });
    expect(f.editing.listGroups('doc', Date.now())).toHaveLength(1);
    f.editing.undo({ documentId: 'doc', viewId: 'view', requestId: randomUUID(), direction: 'undo' }, Date.now()); expect(f.snapshot().elements[0]).toMatchObject({ x: 100, color: 'yellow' });
    f.editing.undo({ documentId: 'doc', viewId: 'view', requestId: randomUUID(), direction: 'redo' }, Date.now()); expect(f.snapshot().elements[0]).toMatchObject({ x: 0, color: 'white' });
  });
  it('rolls the current content and receipt back when durable reverse history cannot be recorded', () => {
    const f = fixture(); f.database.exec("CREATE TRIGGER fail_history BEFORE UPDATE ON canvas_version_heads BEGIN SELECT RAISE(ABORT, 'history failed'); END");
    expect(() => f.commit([add])).toThrow('history failed'); expect(f.snapshot().elements).toEqual([]); expect(f.snapshot().sequence).toBe(0);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM canvas_requests').get()).toEqual({ count: 0 }); expect(f.editing.status('doc', 'view').canUndo).toBe(false);
  });
  it('adds threshold anchors and can preview an older anchor independently of a damaged newer reverse link', () => {
    const f = fixture(); f.commit([add]); f.checkpoint();
    for (let index = 1; index <= 20; index += 1) { f.update({ x: index * 10 }); f.checkpoint(); }
    const anchor = f.database.prepare<[], { version_id: string; sequence: number }>('SELECT version_id, sequence FROM canvas_versions WHERE anchor_blob IS NOT NULL AND sequence > 0 ORDER BY sequence LIMIT 1').get();
    if (!anchor) throw new Error('No threshold anchor'); const saved = f.versions.preview('doc', anchor.version_id);
    f.database.prepare('UPDATE canvas_versions SET reverse_blob = ? WHERE version_id = ?').run(Buffer.from('broken'), 'canvas-version:5');
    expect(f.versions.preview('doc', anchor.version_id)).toEqual(saved); expect(() => f.versions.compact('doc')).toThrow('version_corrupt');
    f.database.prepare('UPDATE canvas_elements SET element_json = ? WHERE element_id = ?').run('{"type":"unknown"}', 'c1');
    expect(f.versions.preview('doc', anchor.version_id)).toEqual(saved);
  });

  it('forces a complete schema-migration boundary even when current content is already checkpointed', () => {
    const f = fixture(); f.commit([add]); f.checkpoint(); const current = f.versions.list('doc')[0];
    f.versions.checkpoint({ documentId: 'doc', reason: 'migration' });
    const record = f.database.prepare<[string], { anchor_blob: Uint8Array | null }>('SELECT anchor_blob FROM canvas_versions WHERE version_id = ?').get(current.versionId);
    expect(record?.anchor_blob).toBeInstanceOf(Uint8Array); expect(f.versions.preview('doc', current.versionId)).toEqual(f.snapshot());
  });

  it('does not report a successful content commit as failed when a post-commit budget notification fails', () => {
    const f = fixture(); f.failNotification(); const result = f.commit([add]);
    expect(result.results[0].status).toBe('applied'); expect(f.snapshot().elements).toHaveLength(1); expect(f.failures).toHaveBeenCalledWith('doc', expect.any(Error));
  });

  it('cascades all version rows on physical document deletion and stops pending timers without false save failures', async () => {
    const f = fixture(); f.commit([add]); f.checkpoint(); f.update({ x: 200 });
    f.database.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('doc');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM canvas_versions').get()).toEqual({ count: 0 }); expect(f.database.prepare('SELECT COUNT(*) AS count FROM canvas_version_heads').get()).toEqual({ count: 0 });
    expect(f.failures).not.toHaveBeenCalled();
  });

});
