import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, type CanvasCommitActor } from '..';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { CANVAS_RECENT_REQUEST_LIMIT } from '../definitions/canvasRequestReceipt';
import { createCanvasPlainTextDocument } from '../../../../shared';

const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'user' };
const actor = (conversationId: string): CanvasCommitActor => ({ source: { kind: 'agent', conversationId, runId: 'run' }, viewId: 'agent' });
const add = { op: 'addText', content: createCanvasPlainTextDocument('测试正文'), width: 240, height: 120 };
function fixture() {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON');
  database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc'), ('other')");
  for (const migration of canvasPluginMigrations) migration.up(database);
  initializeCanvasDocument(database, 'doc'); initializeCanvasDocument(database, 'other');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const commit = (requestId: string, operations: unknown[] = [], documentId = 'doc') => history.commit({
    request: { documentId, requestId, operations }, actor: user, now: ++next,
  });
  const apply = (requestId: string, operations: unknown[], conversationId = 'A') => history.commitAgent({
    request: { documentId: 'doc', requestId, operations }, actor: actor(conversationId), now: ++next,
  });
  return { database, history, commit, apply };
}

it('bounds terminal receipts, preserves pending and referenced outcomes, and withdraws after old success receipts expire', () => {
  const f = fixture();
  try {
    f.apply('agent-create', [add]);
    const skipped = f.apply('referenced-skip', [{ op: 'update', id: 'c1', baseRevision: 0, patch: { color: 'green' } }]);
    f.commit('user-cards', Array.from({ length: 20 }, () => add));
    const deletes = Array.from({ length: 20 }, (_, i) => ({ op: 'delete', id: `c${i + 2}`, baseRevision: 1 }));
    const pending = f.apply('pending', deletes, 'B'); if (pending.kind !== 'pending') throw new Error('Expected approval');
    f.commit('keep-other-document', [], 'other');
    let latest = f.commit('first');
    for (let i = 0; i < CANVAS_RECENT_REQUEST_LIMIT + 5; i++) latest = f.commit(`ordinary-${i}`);
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM canvas_requests WHERE node_id='doc'").get())
      .toEqual({ n: CANVAS_RECENT_REQUEST_LIMIT + 2 });
    expect(f.history.replayAgentRequest({ documentId: 'doc', requestId: 'referenced-skip', actor: actor('A'),
      payloadIdentity: { kind: 'operations', operations: [{ op: 'update', id: 'c1', baseRevision: 0, patch: { color: 'green' } }] } })).toEqual(skipped);
    expect(f.database.prepare("SELECT request_id FROM canvas_requests WHERE request_id='agent-create'").get()).toBeUndefined();
    expect(f.commit(`ordinary-${CANVAS_RECENT_REQUEST_LIMIT + 4}`)).toEqual(latest);
    expect(f.database.prepare("SELECT request_id FROM canvas_requests WHERE node_id='other'").get()).toEqual({ request_id: 'keep-other-document' });
    const deny = { documentId: 'doc', viewId: 'user', requestId: 'deny', pendingId: pending.approval.id, decision: 'deny' } as const;
    expect(f.history.resolveApproval(deny, 10000)).toEqual({ kind: 'denied' });
    expect(f.history.resolveApproval(deny, 10001)).toEqual({ kind: 'denied' });
    expect(f.history.approvalResults('doc', 'B')[0]).toMatchObject({ requestId: 'pending', status: 'denied' });
    const group = f.history.listGroups('doc', 20000).find(group => group.conversationId === 'A');
    if (!group) throw new Error('Missing group');
    f.history.withdraw({ documentId: 'doc', groupId: group.id, requestId: 'withdraw', viewId: 'user' }, 20000);
    expect(readCanvasSnapshot(f.database, 'doc').elements.some(card => card.id === 'c1')).toBe(false);
    f.history.closeGroup({ documentId: 'doc', groupId: group.id });
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM canvas_requests WHERE node_id='doc'").get())
      .toEqual({ n: CANVAS_RECENT_REQUEST_LIMIT });
    expect(readCanvasSnapshot(f.database, 'doc').elements).toHaveLength(20);
  } finally { f.database.close(); }
}, 30000);

it('bounds replaced approvals and gives an old pending request a fresh terminal replay window', () => {
  const f = fixture();
  try {
    f.commit('user-cards', Array.from({ length: 20 }, () => add));
    const deletes = Array.from({ length: 20 }, (_, i) => ({ op: 'delete', id: `c${i + 1}`, baseRevision: 1 }));
    for (let i = 0; i < CANVAS_RECENT_REQUEST_LIMIT + 5; i++) expect(f.apply(`pending-${i}`, deletes).kind).toBe('pending');
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM canvas_requests WHERE node_id='doc'").get())
      .toEqual({ n: CANVAS_RECENT_REQUEST_LIMIT + 1 });
    const group = f.history.listGroups('doc', 20000)[0];
    expect(group.pendingApproval).not.toBeNull();
    f.history.closeGroup({ documentId: 'doc', groupId: group.id });
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM canvas_requests WHERE node_id='doc'").get())
      .toEqual({ n: CANVAS_RECENT_REQUEST_LIMIT });
    expect(f.history.approvalResults('doc', 'A')[0]).toMatchObject({ status: 'closed' });
    expect(readCanvasSnapshot(f.database, 'doc').elements).toHaveLength(20);
  } finally { f.database.close(); }
}, 30000);
