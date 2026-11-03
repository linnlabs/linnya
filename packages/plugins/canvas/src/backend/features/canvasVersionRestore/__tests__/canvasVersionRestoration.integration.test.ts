import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasPlainTextDocument, type CanvasSnapshot } from '../../../../shared';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasCommitState, readCanvasSnapshot, updateCanvasEditingClaim, type CanvasCommitActor } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { planCanvasVersionRestoration } from '..';

const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
const agent: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'chat', runId: 'run' }, viewId: 'agent' };
const text = { op: 'addText', width: 240, height: 120, x: 0, y: 0, content: createCanvasPlainTextDocument('原始正文') };
const databases: Database.Database[] = [];
function fixture() {
  const database = new Database(':memory:'); databases.push(database);
  database.pragma('foreign_keys=ON'); database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc')");
  for (const migration of canvasPluginMigrations) migration.up(database);
  initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database });
  const snapshot = () => readCanvasSnapshot(database, 'doc');
  const commit = (operations: readonly unknown[]) => history.commit({ actor: user, now: 100, request: { documentId: 'doc', requestId: randomUUID(), operations } });
  const restore = (targetSnapshot: CanvasSnapshot) => history.transition({ documentId: 'doc', requestId: randomUUID(), payload: { kind: 'restore', target: targetSnapshot.sequence }, actor: user, now: 200,
    buildPlan: (state, claims, origin) => planCanvasVersionRestoration({ state, claims, origin, actor: user, targetSnapshot, now: 200 }),
  });
  return { database, history, snapshot, commit, restore };
}
function semantic(snapshot: CanvasSnapshot) {
  return [...snapshot.elements].sort((left, right) => left.id.localeCompare(right.id)).map(element =>
    Object.fromEntries(Object.entries(element).filter(([field]) => !['revision', 'updatedAt', 'updatedBy'].includes(field))));
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

describe('Canvas complete historical restoration', () => {
  it('keeps revisions monotonic after deletion guards are gone and rejects an old Agent write to a revived identity', () => {
    const f = fixture();
    f.history.commitAgent({ actor: agent, now: 99, request: { documentId: 'doc', requestId: 'original-agent-create', operations: [{ op: 'addText', width: 240, height: 120, content: text.content }] } });
    const target = f.snapshot();
    for (let index = 0; index < 8; index++) {
      const card = f.snapshot().elements[0];
      f.commit([{ op: 'update', id: card.id, baseRevision: card.revision, patch: { x: index + 1 } }]);
    }
    const deletedRevision = f.snapshot().elements[0].revision;
    f.commit([{ op: 'delete', id: 'c1' }]);
    for (const group of f.history.listGroups('doc', 150)) f.history.closeGroup({ documentId: 'doc', groupId: group.id });
    f.history.releaseView(user.viewId);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM canvas_history_guards').get()).toEqual({ count: 0 });
    expect(readCanvasCommitState(f.database, 'doc').maximumRevision).toBe(deletedRevision);
    f.restore(target);
    expect(f.snapshot().elements[0]).toMatchObject({ id: 'c1', revision: deletedRevision + 1, createdBy: agent.source, updatedBy: user.source });
    const stale = f.history.commitAgent({ actor: agent, now: 201, request: { documentId: 'doc', requestId: 'old-write', operations: [{ op: 'update', id: 'c1', baseRevision: deletedRevision, patch: { color: 'red' } }] } });
    expect(stale).toMatchObject({ kind: 'committed', commit: { results: [{ status: 'skipped', reason: 'stale_field' }] } });
    expect(f.snapshot().elements[0]).toMatchObject({ color: 'white' });
    expect(readCanvasCommitState(f.database, 'doc').maximumRevision).toBe(deletedRevision + 1);
  });

  it('restores exact image/document/edge identities and positions, keeps allocation and open groups, and undoes/redoes the whole graph', () => {
    const f = fixture();
    f.commit([text,
      { op: 'addImage', x: 300, y: 0, width: 240, height: 120, data: { assetId: 'old-image', caption: '原图', alt: '', crop: null } },
      { op: 'addDocument', x: 600, y: 0, width: 240, height: 120, data: { documentId: 'old-document' } },
      { op: 'connect', from: 'c1', to: 'c2', label: '原线' },
    ]);
    const target = f.snapshot();
    f.history.commitAgent({ actor: agent, now: 101, request: { documentId: 'doc', requestId: 'agent-move', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }] } });
    f.commit([{ op: 'update', id: 'c1', baseRevision: 2, patch: { x: 900 } },
      { op: 'delete', id: 'c2' }, { op: 'delete', id: 'c3' },
      { op: 'addImage', x: 300, y: 0, width: 240, height: 120, data: { assetId: 'new-image', caption: '新图', alt: '', crop: null } },
      { op: 'addDocument', x: 600, y: 0, width: 240, height: 120, data: { documentId: 'new-document' } },
      { op: 'connect', from: 'c4', to: 'c5', label: '新线' },
    ]);
    const before = f.snapshot(), allocation = readCanvasCommitState(f.database, 'doc');
    const groups = f.history.listGroups('doc', 150).map(group => group.id);
    const result = f.restore(target);
    expect(result.sequence).toBe(before.sequence + 1); expect(semantic(f.snapshot())).toEqual(semantic(target));
    expect(readCanvasCommitState(f.database, 'doc')).toMatchObject({ nextCard: allocation.nextCard, nextEdge: allocation.nextEdge });
    expect(f.history.listGroups('doc', 201).map(group => group.id)).toEqual(groups);
    f.history.undo({ documentId: 'doc', viewId: user.viewId, requestId: 'undo-restore', direction: 'undo' }, 202);
    expect(semantic(f.snapshot())).toEqual(semantic(before));
    f.history.undo({ documentId: 'doc', viewId: user.viewId, requestId: 'redo-restore', direction: 'redo' }, 203);
    expect(semantic(f.snapshot())).toEqual(semantic(target));
    f.commit([text]); expect(f.snapshot().elements.some(element => element.id === `c${allocation.nextCard}`)).toBe(true);
  });

  it('rejects the entire restore on an actual edited-field conflict but allows an unrelated body claim', () => {
    const f = fixture(); f.commit([text]); const target = f.snapshot();
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 700 } }]);
    const before = f.snapshot();
    updateCanvasEditingClaim(f.database, { documentId: 'doc', viewId: 'other-view', elementId: 'c1', fields: ['x'], now: 190 });
    expect(() => f.restore(target)).toThrow('version_conflict'); expect(f.snapshot()).toEqual(before);
    updateCanvasEditingClaim(f.database, { documentId: 'doc', viewId: 'other-view', elementId: 'c1', fields: ['data'], now: 191 });
    f.restore(target); expect(semantic(f.snapshot())).toEqual(semantic(target));
  });

  it('does not create a transition for commit metadata alone or admit readonly/malformed target graphs', () => {
    const f = fixture(); f.commit([text]); const target = f.snapshot();
    f.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } }, { op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'white' } }]);
    const before = f.snapshot(); f.restore(target); expect(f.snapshot()).toEqual(before);
    expect(() => f.restore({ ...target, elements: [...target.elements, ...target.elements] })).toThrow('version_corrupt');
    expect(() => f.restore({ ...target, integrity: { readOnly: true, formatVersion: 2, issues: [] } })).toThrow('version_corrupt');
    expect(f.snapshot()).toEqual(before);
  });
});
