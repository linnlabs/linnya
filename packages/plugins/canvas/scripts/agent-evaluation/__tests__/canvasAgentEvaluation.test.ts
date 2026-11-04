import { expect, it } from 'vitest';
import { CanvasCommandSchema, createCanvasPlainTextDocument, readCanvasElementText, type CanvasSnapshot } from '../../../src/shared';
import { checkCanvas } from '../../../src/backend/features/canvasQuery';
import { planCanvasCommit, type CanvasCommitState } from '../../../src/backend/features/canvasCommit';
import { createCanvasAgentFixture } from '../functions/createCanvasAgentFixture';
import { evaluateCanvasAgentRun } from '../functions/evaluateCanvasAgentRun';
import { summarizeCanvasAgentRuns } from '../functions/summarizeCanvasAgentRuns';

const actor = { viewId: 'fixture', source: { kind: 'user', conversationId: null, runId: null } } as const;
const empty: CanvasCommitState = { sequence: 0, maximumRevision: 0, nextCard: 1, nextEdge: 1, elements: [], deletedOrigins: {} };
const snapshot = (state: CanvasCommitState): CanvasSnapshot => ({ documentId: 'fixture', schemaVersion: 1, sequence: state.sequence, elements: state.elements.map(row => row.element) });
function evidence(taskId: string, before: CanvasSnapshot, after: CanvasSnapshot) {
  return { fixtureVersion: 1, taskId, sourceRevision: 'a'.repeat(40), batchId: 'test', model: { provider: 'fixture', model: 'test', version: '1' }, imageCapability: 'no-vision', repetition: 1,
    startedAt: 100, finishedAt: 200, before, after, check: checkCanvas(after), documentIds: {}, attempts: [{ phase: 'write', requestId: 'write1', validationAccepted: true, correction: false, responseFile: 'response.json' }], commits: [],
    controls: { approvalShown: false, approvalDecision: null, editedCardId: null, renderCount: 0, imageReadCount: 0, imageReadSequence: null }, metrics: {}, evidenceFiles: ['trace.json'] };
}
function reviewedResearchGraph() {
  const headings = ['发现总览', '支持分组说明', '反对分组说明'];
  const operations = [
    ...Array.from({ length: 3 }, (_, index) => CanvasCommandSchema.parse({ op: 'addDocument', ref: `$source${index}`, width: 240, height: 120, data: { documentId: `research-${index}` } })),
    ...headings.map(text => CanvasCommandSchema.parse({ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument(text) })),
    ...Array.from({ length: 18 }, (_, index) => [
      CanvasCommandSchema.parse({ op: 'addText', ref: `$finding${index}`, width: 240, height: 120, content: createCanvasPlainTextDocument(`独立观察${index}`) }),
      CanvasCommandSchema.parse({ op: 'connect', from: `$finding${index}`, to: `$source${index % 3}` }),
    ]).flat(),
  ];
  const plan = planCanvasCommit({ state: empty, operations, actor, origin: 'research', claims: [], now: 2 });
  const after = snapshot(plan.state);
  const organizationCards = headings.map(reason => {
    const card = after.elements.find(element => element.type === 'text' && readCanvasElementText(element) === reason);
    if (!card) throw new Error('Missing research organization fixture');
    return { id: card.id, reason: `版面组织用途：${reason}，不增加独立观察` };
  });
  const review = { approved: true, reviewer: 'research reviewer', notes: '逐一核对所有发现和组织卡的语义、去重及来源', taskFacts: { taskId: 'T2', organizationCards } };
  return { after, review, run: { ...evidence('T2', snapshot(empty), after), review } };
}
it('T2只排除明确审定的组织卡，18条真实发现仍逐一检查来源，漏线不能被当作标题忽略', () => {
  const { after, review, run } = reviewedResearchGraph();
  expect(evaluateCanvasAgentRun({ ...run, review: { approved: true, reviewer: review.reviewer, notes: review.notes } }).failures)
    .toContainEqual(expect.objectContaining({ rule: '12-18-findings', detail: 'findings=21' }));
  expect(evaluateCanvasAgentRun(run)).toMatchObject({ status: 'passed', failures: [] });
  const edge = after.elements.find(element => element.type === 'edge');
  if (!edge) throw new Error('Missing research source edge');
  const unlinked = { ...after, elements: after.elements.filter(element => element.id !== edge.id) };
  expect(evaluateCanvasAgentRun({ ...run, after: unlinked, check: checkCanvas(unlinked) }).failures)
    .toContainEqual(expect.objectContaining({ rule: 'finding-source-links' }));
  expect(evaluateCanvasAgentRun({ ...run, review: { ...review, approved: false } }).status).toBe('needs_review');
});
it('T2组织卡审阅不能排除重复身份、不存在或非文字卡，也不能挪到别题', () => {
  const { after, review, run } = reviewedResearchGraph();
  const document = after.elements.find(element => element.type === 'document');
  if (!document) throw new Error('Missing research source document');
  for (const organizationCards of [
    [review.taskFacts.organizationCards[0], review.taskFacts.organizationCards[0]],
    [{ id: 'c9999', reason: '不存在的标题' }],
    [{ id: document.id, reason: '不能把来源文档排除' }],
    [{ id: review.taskFacts.organizationCards[0].id, reason: '   ' }],
  ]) expect(() => evaluateCanvasAgentRun({ ...run, review: { ...review, taskFacts: { taskId: 'T2', organizationCards } } })).toThrow();
  expect(() => evaluateCanvasAgentRun({ ...run, taskId: 'T1' })).toThrow('只适用于T2');
});
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
  expect(evaluateCanvasAgentRun({ ...reviewed, after: snapshot(broken.state), check: checkCanvas(snapshot(broken.state)) }).failures).toContainEqual(expect.objectContaining({ rule: 'original-scenes-unchanged', passed: false }));
});
it('预检成功不冒充正式首写，预检中的真实修正仍计入修正总数', () => {
  const run = { ...evidence('T12', snapshot(empty), snapshot(empty)), attempts: [
    { phase: 'dry-run', requestId: null, validationAccepted: false, correction: false, responseFile: 'preflight-error.json' },
    { phase: 'dry-run', requestId: 'preview2', validationAccepted: true, correction: true, responseFile: 'preflight-fixed.json' },
  ] };
  expect(evaluateCanvasAgentRun(run)).toMatchObject({ firstSubmissionAccepted: false, correctionRetries: 1 });
  expect(evaluateCanvasAgentRun({ ...run, attempts: [...run.attempts, { phase: 'write', requestId: 'write1', validationAccepted: false, correction: false, responseFile: 'write-error.json' }] }).firstSubmissionAccepted).toBe(false);
  expect(evaluateCanvasAgentRun({ ...run, attempts: [...run.attempts, { phase: 'write', requestId: 'write1', validationAccepted: true, correction: false, responseFile: 'write.json' }] }).firstSubmissionAccepted).toBe(true);
});
it('cannot report a denied destructive request successful when the actual snapshot shows deleted cards', () => {
  const fixture = createCanvasAgentFixture('T12');
  const initial = planCanvasCommit({ state: empty, operations: fixture.userSeedOperations, actor, origin: 'seed', claims: [], now: 1 });
  const run = { ...evidence('T12', snapshot(initial.state), snapshot(initial.state)), controls: { approvalShown: true, approvalDecision: 'deny', editedCardId: null, renderCount: 0, imageReadCount: 0, imageReadSequence: null }, review: { approved: true, reviewer: 'UI reviewer', notes: '拒绝事实已核对' } };
  expect(evaluateCanvasAgentRun(run).status).toBe('passed');
  const deleted = planCanvasCommit({ state: initial.state, actor, origin: 'bad', claims: [], now: 2, operations: initial.state.elements.map(row => CanvasCommandSchema.parse({ op: 'delete', id: row.element.id })) });
  expect(evaluateCanvasAgentRun({ ...run, after: snapshot(deleted.state), check: checkCanvas(snapshot(deleted.state)) }).status).toBe('failed');
});

it('keeps duplicate or incomplete trials from becoming a passing model group and requires actual tool images for vision', () => {
  const fixture = createCanvasAgentFixture('T12');
  const initial = planCanvasCommit({ state: empty, operations: fixture.userSeedOperations, actor, origin: 'seed', claims: [], now: 1 });
  const run = { ...evidence('T12', snapshot(initial.state), snapshot(initial.state)),
    controls: { approvalShown: true, approvalDecision: 'deny', editedCardId: null, renderCount: 0, imageReadCount: 0, imageReadSequence: null },
    review: { approved: true, reviewer: 'UI reviewer', notes: '已确认拒绝后原卡完整保留' } };
  expect(evaluateCanvasAgentRun(run).status).toBe('passed');
  expect(evaluateCanvasAgentRun({ ...run, imageCapability: 'vision' }).status).toBe('failed');
  const vision = { ...run, imageCapability: 'vision', controls: { ...run.controls, renderCount: 1, imageReadCount: 1, imageReadSequence: run.after.sequence } };
  expect(evaluateCanvasAgentRun(vision).status).toBe('passed');
  expect(evaluateCanvasAgentRun({ ...vision, controls: { ...vision.controls, imageReadSequence: run.after.sequence - 1 } }).status).toBe('failed');
  const summary = summarizeCanvasAgentRuns([run, run]);
  expect(summary.passed).toBe(false);
  expect(summary.groups[0]).toMatchObject({ complete: false, duplicateIdentities: ['T12:1'] });
  expect(summary.groups[0].missing).toContain('T1:1');
  expect(summary.groups[0].completionRate).toBeLessThan(0.85);
});
