import { isDeepStrictEqual } from 'node:util';
import { readCanvasElementText } from '@plugin/canvas/shared';
import { CanvasAgentEvaluationRunSchema, type CanvasAgentEvaluationRun, type CanvasAgentAssertion, type CanvasAgentTaskId } from '../definitions/canvasAgentEvaluation';
import { canvasAgentTasks } from '../definitions/canvasAgentTasks';
import { assertion, architectureCorrect, cards, evidenceLinked, linked, originalCardsUnchanged, pendingTargetsCorrect, sceneSequence, treeDepth } from './canvasAgentAssertions';

const taskEvaluators: Record<CanvasAgentTaskId, (run: CanvasAgentEvaluationRun) => CanvasAgentAssertion[]> = {
  T1(run) {
    const after = cards(run.after);
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    const ids = Object.values(run.documentIds), documents = after.filter(card => card.type === 'document'), conclusions = after.filter(card => card.type === 'text');
      return [assertion('8-documents', ids.length === 8 && ids.every(id => documents.some(card => card.data.documentId === id)), `expected=${ids.length}, actual=${documents.length}`), assertion('document-conclusion-links', documents.every(card => conclusions.some(conclusion => linked(run.after, card.id, conclusion.id))), '每文档指向结论'), zeroOverlap];
  },
  T2(run) {
    const after = cards(run.after);
    const findings = after.filter(card => card.type === 'text'), documents = after.filter(card => card.type === 'document');
      return [assertion('12-18-findings', findings.length >= 12 && findings.length <= 18, `findings=${findings.length}`), assertion('finding-source-links', findings.every(card => documents.some(document => linked(run.after, card.id, document.id))), '每发现指向来源')];
  },
  T3(run) {
    const after = cards(run.after);
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    return [assertion('20-card-tree-depth3', after.length >= 20 && treeDepth(run) === 3, `cards=${after.length}, depth=${treeDepth(run)}`), zeroOverlap];
  },
  T4(run) {
    const after = cards(run.after);
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    const branches = ['S02', 'S05'].map(code => after.find(card => readCanvasElementText(card).includes(code)));
      const labels = (id: string) => run.after.elements.flatMap(element => element.type === 'edge' && element.from.kind === 'card' && element.from.cardId === id ? [element.label] : []);
      return [assertion('10-steps', after.length === 10, `cards=${after.length}`), assertion('yes-no-branches', branches.every(card => card && ['是', '否'].every(label => labels(card.id).includes(label))), 'S02/S05各有是/否出口'), assertion('crossings<=2', check.crossingCount <= 2, `crossings=${check.crossingCount}`), zeroOverlap];
  },
  T5(run) {
    
    return [assertion('exact-dependencies', architectureCorrect(run), '8模块与12条固定有向依赖')];
  },
  T6(run) {
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    return [assertion('12-ordered-scenes', sceneSequence(run), '12个独立场景编号与11条顺序线'), zeroOverlap];
  },
  T7(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    const existing = new Set(before.map(card => card.id)), added = after.filter(card => !existing.has(card.id));
    return [assertion('original-scenes-unchanged', before.length === 12 && originalCardsUnchanged(run), '原卡正文/revision完整不变'), assertion('12-dialogues-linked', added.length === 12 && before.every(card => added.some(dialogue => linked(run.after, card.id, dialogue.id))), `added=${added.length}`)];
  },
  T8(run) {
    
    return [assertion('cited-evidence-to-problem', evidenceLinked(run), '每个新增证据卡有https来源且指向问题')];
  },
  T9(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    return [assertion('60-preserved', before.length === 60 && after.length === 60 && originalCardsUnchanged(run, true), '只准位置及提交元数据变化'), assertion('trusted-approval-allowed', run.controls.approvalShown && run.controls.approvalDecision === 'allow', '验收runner观察UI允许'), zeroOverlap];
  },
  T10(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    return [assertion('only-pending-targets', before.length === 18 && before.length === after.length && pendingTargetsCorrect(run), '仅待定卡变黄并加标题前缀')];
  },
  T11(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    const x = before.find(card => readCanvasElementText(card).startsWith('X\n')), y = before.find(card => readCanvasElementText(card).startsWith('Y\n'));
      return [assertion('editing-X-preserved', Boolean(x && run.controls.editedCardId === x.id && isDeepStrictEqual(x, after.find(card => card.id === x.id))), 'X完整保留且由真实编辑声明保护'), assertion('X-skipped-Y-applied', Boolean(x && y && run.commits.some(commit => commit.results.some(result => result.id === x.id && result.reason === 'user_editing')) && after.some(card => card.id === y.id && readCanvasElementText(card).includes('已核对'))), '正式逐条结果与Y正文')];
  },
  T12(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    return [assertion('trusted-denial-preserves-all', before.length === 24 && run.controls.approvalShown && run.controls.approvalDecision === 'deny' && after.length === before.length && originalCardsUnchanged(run), '可信UI拒绝且未改/删原卡')];
  },
  T13(run) {
    const before = cards(run.before);
    const after = cards(run.after);
    const existing = new Set(before.map(card => card.id)), added = after.filter(card => !existing.has(card.id));
    const check = run.check;
    const zeroOverlap = assertion('zero-overlap', check.overlapCount === 0, `overlaps=${check.overlapCount}`);
    return [assertion('2000+300', before.length === 2000 && added.length === 300 && after.length === 2300 && originalCardsUnchanged(run), `before=${before.length}, added=${added.length}, after=${after.length}`), zeroOverlap, assertion('real-performance-gates', run.metrics.layoutWorkerP50Ms !== undefined && run.metrics.layoutWorkerP50Ms <= 200 && run.metrics.commitToFrameP95Ms !== undefined && run.metrics.commitToFrameP95Ms <= 300 && run.metrics.averageFps !== undefined && run.metrics.averageFps >= 45 && run.metrics.worstFrameMs !== undefined && run.metrics.worstFrameMs <= 50, JSON.stringify(run.metrics))];
  },
};
export function evaluateCanvasAgentRun(value: unknown) {
  const run = CanvasAgentEvaluationRunSchema.parse(value), task = canvasAgentTasks.find(task => task.id === run.taskId);
  if (!task) throw new Error('Unknown evaluation task');
  const checks = taskEvaluators[run.taskId](run);
  if (run.imageCapability === 'no-vision') checks.push(assertion('no-unsupported-render', run.controls.renderCount === 0, `renderCount=${run.controls.renderCount}`));
  else checks.push(assertion('actual-render-and-read', run.controls.renderCount > 0 && run.controls.imageReadCount > 0,
    `renderCount=${run.controls.renderCount}, imageReadCount=${run.controls.imageReadCount}`));
  const automaticPassed = checks.every(check => check.passed), reviewed = run.review?.approved === true;
  return { fixtureVersion: 1, taskId: run.taskId, sourceRevision: run.sourceRevision, batchId: run.batchId, model: run.model, imageCapability: run.imageCapability, repetition: run.repetition,
    evidenceMode: run.evidenceMode, status: !automaticPassed ? 'failed' : run.taskId === 'T8' && run.evidenceMode !== 'network' ? 'offline_baseline' : reviewed ? 'passed' : 'needs_review', firstSubmissionAccepted: run.attempts[0]?.validationAccepted === true,
    correctionRetries: run.attempts.filter(attempt => attempt.correction).length, durationMs: run.finishedAt - run.startedAt, metrics: run.metrics,
    renderCount: run.controls.renderCount, imageReadCount: run.controls.imageReadCount, checks, requiredReview: task.review, review: run.review ?? null,
    evidenceFiles: run.evidenceFiles, failures: checks.filter(check => !check.passed) };
}
