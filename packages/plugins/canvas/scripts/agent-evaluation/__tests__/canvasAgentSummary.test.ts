import { expect, it, vi } from 'vitest';
import { CanvasAgentEvaluationRunSchema, canvasAgentTaskIds } from '../definitions/canvasAgentEvaluation';
import { evaluateCanvasAgentRun } from '../functions/evaluateCanvasAgentRun';
import { summarizeCanvasAgentRuns } from '../functions/summarizeCanvasAgentRuns';

vi.mock('../functions/evaluateCanvasAgentRun');

it('12题通过加离线T8不获得正式13题资格，真实联网组仍按原阈值统计', async () => {
  const actual = await vi.importActual<typeof import('../functions/evaluateCanvasAgentRun')>('../functions/evaluateCanvasAgentRun');
  // 只验证汇总资格：逐题报告由可控端口提供，不把本测试的空图或review当作真实模型证据。
  vi.mocked(evaluateCanvasAgentRun).mockImplementation(value => {
    const report = actual.evaluateCanvasAgentRun(value);
    return { ...report, firstSubmissionAccepted: true, correctionRetries: 0,
      status: report.taskId === 'T8' && report.evidenceMode !== 'network' ? 'offline_baseline' : 'passed', failures: [] };
  });
  const snapshot = { schemaVersion: 1, documentId: 'fixture', sequence: 0, elements: [] };
  const runs = canvasAgentTaskIds.map(taskId => CanvasAgentEvaluationRunSchema.parse({
    fixtureVersion: 1, taskId, sourceRevision: 'a'.repeat(40), batchId: 'test', model: { provider: 'test', model: 'test', version: '1' },
    imageCapability: 'no-vision', evidenceMode: taskId === 'T8' ? 'offline' : 'not-applicable', repetition: 1,
    startedAt: 1, finishedAt: 2, before: snapshot, after: snapshot,
    check: { sequence: 0, cardCount: 0, edgeCount: 0, overlapCount: 0, crossingCount: 0, overlaps: [], crossings: [], longEdges: [], outliers: [], note: 'test' },
    attempts: [], commits: [], controls: { approvalShown: false, approvalDecision: null, editedCardId: null, renderCount: 0, imageReadCount: 0, imageReadSequence: null },
    metrics: {}, evidenceFiles: ['controlled-reports.json'],
  }));
  const offline = summarizeCanvasAgentRuns(runs);
  expect(offline.groups[0]).toMatchObject({ complete: true, firstSubmissionRate: 1, completionRate: 12 / 13,
    averageCorrections: 0, nonNetworkTasks: ['T8:1'], passed: false });
  expect(offline.passed).toBe(false);
  const network = summarizeCanvasAgentRuns(runs.map(run => run.taskId === 'T8' ? { ...run, evidenceMode: 'network' } : run));
  expect(network.groups[0]).toMatchObject({ complete: true, completionRate: 1, nonNetworkTasks: [], passed: true });
  expect(network.passed).toBe(true);
});
