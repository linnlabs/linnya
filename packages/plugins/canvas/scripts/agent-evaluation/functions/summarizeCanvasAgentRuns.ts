import { CanvasAgentEvaluationRunSchema, canvasAgentTaskIds } from '../definitions/canvasAgentEvaluation';
import { evaluateCanvasAgentRun } from './evaluateCanvasAgentRun';

/** 按实际模型和看图能力分别统计；漏题、漏重复或只留下最好一次都不能达标。 */
export function summarizeCanvasAgentRuns(values: readonly unknown[]) {
  const groups = new Map<string, ReturnType<typeof evaluateCanvasAgentRun>[]>();
  for (const value of values) {
    const run = CanvasAgentEvaluationRunSchema.parse(value);
    const key = JSON.stringify([run.sourceRevision, run.batchId, run.model.provider, run.model.model, run.model.version, run.imageCapability]);
    const reports = groups.get(key) ?? [];
    reports.push(evaluateCanvasAgentRun(run)); groups.set(key, reports);
  }
  const summaries = [...groups.values()].map(reports => {
    const first = reports[0], repetitions = Math.max(...reports.map(report => report.repetition));
    const identities = reports.map(report => `${report.taskId}:${report.repetition}`), unique = new Set(identities);
    const expected = canvasAgentTaskIds.length * repetitions;
    const missing = canvasAgentTaskIds.flatMap(taskId => Array.from({ length: repetitions }, (_, index) => `${taskId}:${index + 1}`).filter(identity => !unique.has(identity)));
    const complete = reports.length === expected && unique.size === reports.length && missing.length === 0;
    const firstAccepted = reports.filter(report => report.firstSubmissionAccepted).length;
    const completed = reports.filter(report => report.status === 'passed').length;
    // 离线来源基线不是一次正式联网任务；不能借允许少量任务失败的完成率门槛获得整组资格。
    const nonNetworkTasks = reports.filter(report => report.taskId === 'T8' && report.evidenceMode !== 'network').map(report => `${report.taskId}:${report.repetition}`);
    const corrections = reports.reduce((sum, report) => sum + report.correctionRetries, 0);
    const firstSubmissionRate = firstAccepted / expected, completionRate = completed / expected, averageCorrections = corrections / expected;
    return { sourceRevision: first.sourceRevision, batchId: first.batchId, model: first.model, imageCapability: first.imageCapability, repetitions, expected, observed: reports.length, complete, missing,
      duplicateIdentities: [...unique].filter(identity => identities.filter(value => value === identity).length > 1),
      firstSubmissionRate, completionRate, averageCorrections,
      nonNetworkTasks,
      passed: complete && nonNetworkTasks.length === 0 && firstSubmissionRate >= 0.9 && completionRate >= 0.85 && averageCorrections <= 0.3,
      tasks: reports.map(report => ({ taskId: report.taskId, repetition: report.repetition, status: report.status, failures: report.failures, evidenceFiles: report.evidenceFiles })),
    };
  });
  return { fixtureVersion: 1, passed: summaries.length > 0 && summaries.every(group => group.passed), groups: summaries };
}
