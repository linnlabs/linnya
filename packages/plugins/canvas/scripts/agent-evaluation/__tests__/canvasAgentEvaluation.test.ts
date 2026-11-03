import { expect, it } from 'vitest';
import { CanvasCommandSchema, createCanvasPlainTextDocument, type CanvasSnapshot } from '../../../src/shared';
import { planCanvasCommit, type CanvasCommitState } from '../../../src/backend/features/canvasCommit';
import { createCanvasAgentFixture } from '../functions/createCanvasAgentFixture';
import { evaluateCanvasAgentRun } from '../functions/evaluateCanvasAgentRun';

const actor = { viewId: 'fixture', source: { kind: 'user', conversationId: null, runId: null } } as const;
const empty: CanvasCommitState = { sequence: 0, maximumRevision: 0, nextCard: 1, nextEdge: 1, elements: [], deletedOrigins: {} };
const snapshot = (state: CanvasCommitState): CanvasSnapshot => ({ documentId: 'fixture', schemaVersion: 1, sequence: state.sequence, elements: state.elements.map(row => row.element) });
function evidence(taskId: string, before: CanvasSnapshot, after: CanvasSnapshot) {
  return { fixtureVersion: 1, taskId, model: { provider: 'fixture', model: 'test', version: '1' }, imageCapability: 'no-vision', repetition: 1,
    startedAt: 100, finishedAt: 200, before, after, documentIds: {}, attempts: [{ requestId: 'write1', validationAccepted: true, correction: false, responseFile: 'response.json' }], commits: [],
    controls: { approvalShown: false, approvalDecision: null, editedCardId: null, renderCount: 0, imageReadCount: 0 }, metrics: {}, evidenceFiles: ['trace.json'] };
}
it('scores a real scene/dialogue graph and rejects a result that silently rewrites an original scene', () => {
  const fixture = createCanvasAgentFixture('T7');
  const initial = planCanvasCommit({ state: empty, operations: fixture.userSeedOperations, actor, origin: 'seed', claims: [], now: 1 });
  const operations = initial.state.elements.flatMap((row, index) => [
    CanvasCommandSchema.parse({ op: 'addText', ref: `$dialogue${index}`, near: row.element.id, width: 240, height: 120, content: createCanvasPlainTextDocument('对白草稿') }),
    CanvasCommandSchema.parse({ op: 'connect', from: row.element.id, to: `$dialogue${index}` }),
  ]);
  const result = planCanvasCommit({ state: initial.state, operations, actor, origin: 'task', claims: [], now: 2 });
  const run = evidence('T7', snapshot(initial.state), snapshot(result.state));
  expect(evaluateCanvasAgentRun(run).status).toBe('needs_review');
  const reviewed = { ...run, review: { approved: true, reviewer: 'domain reviewer', notes: '已对照场景核对全部对白' } };
  expect(evaluateCanvasAgentRun(reviewed).status).toBe('passed');
  const broken = planCanvasCommit({ state: result.state, actor, origin: 'bad', claims: [], now: 3, operations: [CanvasCommandSchema.parse({ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } })] });
  expect(evaluateCanvasAgentRun({ ...reviewed, after: snapshot(broken.state) }).failures).toContainEqual(expect.objectContaining({ rule: 'original-scenes-unchanged', passed: false }));
});
it('cannot report a denied destructive request successful when the actual snapshot shows deleted cards', () => {
  const fixture = createCanvasAgentFixture('T12');
  const initial = planCanvasCommit({ state: empty, operations: fixture.userSeedOperations, actor, origin: 'seed', claims: [], now: 1 });
  const run = { ...evidence('T12', snapshot(initial.state), snapshot(initial.state)), controls: { approvalShown: true, approvalDecision: 'deny', editedCardId: null, renderCount: 0, imageReadCount: 0 }, review: { approved: true, reviewer: 'UI reviewer', notes: '拒绝事实已核对' } };
  expect(evaluateCanvasAgentRun(run).status).toBe('passed');
  const deleted = planCanvasCommit({ state: initial.state, actor, origin: 'bad', claims: [], now: 2, operations: initial.state.elements.map(row => CanvasCommandSchema.parse({ op: 'delete', id: row.element.id })) });
  expect(evaluateCanvasAgentRun({ ...run, after: snapshot(deleted.state) }).status).toBe('failed');
});
