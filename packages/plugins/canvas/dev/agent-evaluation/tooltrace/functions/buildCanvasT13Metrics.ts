import { CanvasSnapshotSchema } from '@plugin/canvas/shared';
import { isDeepStrictEqual } from 'node:util';
import type { CanvasToolTraceFacts } from '../definitions/canvasToolTrace';
import { CanvasT13ObservationSchema, CanvasT13ProtocolSchema, CanvasT13SummarySchema,
  CanvasT13ReadinessSchema, type CanvasT13BridgeExchange, type CanvasT13FrameSample } from '../definitions/canvasT13Metrics';
import { admitCanvasDraftSource } from './admitCanvasDraftSource';
import { readCanvasDraftFinishedAt } from './admitCanvasDraftEvidence';
import { admitCanvasT13Observation, CanvasT13EvidenceError } from './admitCanvasT13Observation';

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : undefined;
};

/** 只合成事实与数值；唯一assess负责阈值，慢样本不能在这里丢弃或改成partial。 */
export function buildCanvasT13Metrics(input: {
  readonly state: unknown; readonly collection: unknown; readonly before: unknown; readonly after: unknown;
  readonly result: unknown; readonly facts: CanvasToolTraceFacts; readonly protocol: unknown; readonly summary: unknown;
  readonly observations: readonly unknown[]; readonly exchanges: readonly CanvasT13BridgeExchange[];
  readonly evidenceFiles: readonly string[]; readonly diagnostics: readonly string[];
}) {
  const source = admitCanvasDraftSource({ ...input, evidenceFiles: input.evidenceFiles });
  const { state, collection, scope, before, after, startedAt } = source;
  if (state.config.taskId !== 'T13') throw new Error('T13 metrics require the fixed T13 task');
  const protocol = CanvasT13ProtocolSchema.parse(input.protocol), summary = CanvasT13SummarySchema.parse(input.summary);
  if (protocol.sourceRevision !== scope.sourceRevision || summary.sourceRevision !== scope.sourceRevision
    || protocol.batchId !== scope.batchId || summary.batchId !== scope.batchId
    || protocol.documentId !== scope.documentId || summary.documentId !== scope.documentId
    || protocol.projectId !== state.projectId || protocol.initialSequence !== before.sequence)
    throw new Error('T13 observer belongs to another frozen evaluation');
  const diagnostics = [...input.diagnostics];
  const finishedAt = readCanvasDraftFinishedAt(input.result, { ...scope, runId: source.finalRunId });
  if (finishedAt === undefined || summary.terminalObservedAt === null
    || finishedAt > summary.endedAt || protocol.startedAt > startedAt) diagnostics.push('observer_run_window_incomplete');
  const onlyAttemptUncertainty = input.facts.needsReview && input.facts.diagnostics.length > 0
    && input.facts.diagnostics.every(diagnostic => diagnostic.code === 'correction_unknown');
  if (!collection.sourceValid || !collection.messagesComplete || !collection.evidenceComplete
    || (input.facts.needsReview && !onlyAttemptUncertainty))
    diagnostics.push('formal_collection_or_tooltrace_incomplete');
  const originalIds = new Set(before.elements.map(element => element.id));
  const original = input.exchanges.filter(exchange => exchange.command.kind === 'read').some(exchange => {
    const parsed = CanvasSnapshotSchema.safeParse(typeof exchange.value === 'object' && exchange.value !== null
      ? Reflect.get(exchange.value, 'snapshot') : undefined);
    return parsed.success && isDeepStrictEqual(parsed.data, before);
  });
  if (!original || before.elements.filter(element => element.type !== 'edge').length !== 2000)
    diagnostics.push('original_2000_snapshot_proof_missing');
  if (!input.exchanges.some(exchange => {
    if (exchange.command.kind !== 'readiness' || exchange.receivedAt > protocol.startedAt) return false;
    const parsed = CanvasT13ReadinessSchema.safeParse(exchange.value);
    return parsed.success && parsed.data.documentId === scope.documentId && parsed.data.sequence === before.sequence
      && isDeepStrictEqual([...exchange.command.payload.elementIds].sort(),
        before.elements.filter(element => element.type !== 'edge').map(element => element.id).sort())
      && isDeepStrictEqual(parsed.data.environment, protocol.naturalEnvironment);
  })) diagnostics.push('initial_natural_environment_proof_missing');
  const observations = input.observations.map(value => CanvasT13ObservationSchema.parse(value));
  if (summary.sampleCount !== observations.length || new Set(observations.map(value => value.sequence)).size !== observations.length)
    diagnostics.push('observer_delta_ledger_incomplete');
  const samples: ReturnType<typeof admitCanvasT13Observation>[] = [];
  // 正式Core只有applied才append变化；empty/all-skipped确认请求不会推进sequence或publish delta。
  const actualChanges = input.facts.commits.filter(commit => commit.results.some(result => result.status === 'applied'));
  for (const observation of observations) {
    const commits = actualChanges.filter(commit => commit.sequence === observation.sequence);
    if (commits.length !== 1 || finishedAt === undefined) { diagnostics.push(`commit_not_uniquely_attributed:${observation.sequence}`); continue; }
    try { samples.push(admitCanvasT13Observation({ observation, commit: commits[0], originalIds,
      exchanges: input.exchanges, startedAt, finishedAt })); }
    catch (error) {
      if (!(error instanceof CanvasT13EvidenceError)) throw error;
      diagnostics.push(`${error.message}:${observation.sequence}`);
    }
  }
  const committed = actualChanges.filter(commit => commit.sequence > before.sequence);
  if (!committed.length || committed.some(commit => !samples.some(sample => sample.requestId === commit.requestId)))
    diagnostics.push('actual_commit_observation_missing');
  for (const card of after.elements.filter(element => element.type !== 'edge' && !originalIds.has(element.id)))
    if (!samples.some(sample => sample.targets.some(target => target.id === card.id && target.revision === card.revision)))
      diagnostics.push(`final_card_revision_unobserved:${card.id}`);
  const worker = input.facts.layoutComputations;
  if (!worker.length) diagnostics.push('node_worker_samples_missing');
  if (input.facts.layoutComputationGaps.length) diagnostics.push('node_worker_sample_coverage_incomplete');
  const frames = new Map<number, CanvasT13FrameSample>();
  for (const sample of samples) for (const frame of sample.frameWindow.frames.samples) {
    const previous = frames.get(frame.at);
    if (previous && previous.interval !== frame.interval) diagnostics.push('overlapping_frame_conflict');
    frames.set(frame.at, frame);
  }
  if (!frames.size) diagnostics.push('frame_samples_missing');
  const intervals = [...frames.values()].sort((a, b) => a.at - b.at), total = intervals.reduce((sum, sample) => sum + sample.interval, 0);
  const metrics = { layoutWorkerP50Ms: percentile(worker.map(sample => sample.computation.executionMs), .5),
    commitToFrameP95Ms: percentile(samples.map(sample => sample.commitToFrameUpperBoundMs), .95),
    averageFps: total ? intervals.length * 1000 / total : undefined,
    frameP95Ms: percentile(intervals.map(sample => sample.interval), .95),
    worstFrameMs: percentile(intervals.map(sample => sample.interval), 1) };
  const evidenceFiles = [...new Set([...input.evidenceFiles, ...samples.flatMap(sample => sample.evidenceFiles)])];
  return { kind: diagnostics.length ? 'needs-evidence' as const : 'complete' as const,
    witness: { scope, metrics, evidenceFiles }, diagnostics,
    facts: { scope, measurement: protocol.measurement, body: protocol.body, computedMetrics: metrics, initialEnvironment: protocol.naturalEnvironment,
      attemptDiagnostics: input.facts.diagnostics.filter(diagnostic => diagnostic.code === 'correction_unknown'),
      confirmedRequests: input.facts.commits.map(commit => ({ requestId: commit.requestId, sequence: commit.sequence,
        actualChanges: commit.results.some(result => result.status === 'applied') })),
      quantile: 'sorted-floor((N-1)*q)', workerSampleCount: worker.length, workerSamples: worker,
      commitSampleCount: samples.length, commitSamples: samples, frameSampleCount: intervals.length, frameSamples: intervals,
      limitations: ['N是本次实际样本，不宣称稳定总体P95', 'commit到post-fit实际draw是含导航/轮询/HTTP的保守上界',
        'overview/thumbnail几何与当前正文交集分开，不能称全部正文完成', '相交帧保留完整边界间隔，重叠窗口按绝对时刻去重',
        '9/17ms目标与实际帧原值另报，不在collector复制通过规则', '本模块不替代屏幕/焦点/温度/同源的独立真机资格'] } };
}
