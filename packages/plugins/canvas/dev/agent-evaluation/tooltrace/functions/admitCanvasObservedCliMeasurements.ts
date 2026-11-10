import { isDeepStrictEqual } from 'node:util';
import { CanvasCommitResultSchema } from '@plugin/canvas/shared';
import type { CanvasSealedCliObservation } from '../../cli-observation';
import type { CanvasTraceScope } from '../definitions/canvasToolTrace';
import type { CanvasObservedCliMeasurements } from '../definitions/canvasObservedCliMeasurements';
import { readAllowedCanvasTraceRuns } from './readAllowedCanvasTraceRuns';
import { admitCanvasTraceResponse } from './admitCanvasTraceResponse';

/** Host冻结身份+完整原响应是独立测量来源，不修改原工具语义trace，也不臆造toolCallId。 */
export function admitCanvasObservedCliMeasurements(input: {
  readonly observation: CanvasSealedCliObservation; readonly scope: CanvasTraceScope; readonly projectId: string;
  readonly sourceRevision: string; readonly audit: unknown; readonly continuationAudits?: readonly unknown[];
  readonly startedAt: number; readonly finishedAt: number;
}): CanvasObservedCliMeasurements {
  const { observation } = input, activation = observation.activation;
  const diagnostics: string[] = [], excluded: CanvasObservedCliMeasurements['excluded'][number][] = [];
  const freshWithoutLayout: CanvasObservedCliMeasurements['freshWithoutLayout'][number][] = [];
  const commitSources: CanvasObservedCliMeasurements['commitSources'][number][] = [];
  const layoutComputations: CanvasObservedCliMeasurements['layoutComputations'][number][] = [], commits = new Map<string, CanvasObservedCliMeasurements['commits'][number]>();
  const allowed = readAllowedCanvasTraceRuns(input);
  if (!allowed) diagnostics.push('cli_official_run_graph_incomplete');
  const sourceQualified = activation.productionSourceRevision === input.sourceRevision && activation.observedAt <= input.startedAt
    && observation.session.startedAt <= input.startedAt && observation.finishedAt >= input.finishedAt;
  if (!sourceQualified)
    diagnostics.push('cli_observer_source_or_window_mismatch');
  for (const row of observation.invocations) {
    const exclude = (reason: string) => excluded.push({ invocationId: row.invocationId, reason, sourceFiles: row.sourceFiles });
    if (!sourceQualified || !allowed) { exclude('source-or-official-run-graph-unqualified'); continue; }
    // prepare没有执行context，即使编号/时间看似吻合也不能补成当前模型的失败或dry-run。
    if (row.stage === 'prepare' || row.identity === null) { exclude('unattributed-no-execution-context'); continue; }
    const identity = row.identity;
    if (!identity.agentRunId || !identity.conversationId || !identity.projectId) {
      exclude('execution-identity-incomplete'); diagnostics.push(`cli_execution_identity_incomplete:${row.recordingId}`); continue;
    }
    if (!allowed?.has(identity.agentRunId)) { exclude('outside-official-run-graph'); continue; }
    if (identity.projectId !== input.projectId || identity.conversationId !== input.scope.conversationId
      || row.startedAt === null || row.startedAt < input.startedAt || row.finishedAt > input.finishedAt) {
      diagnostics.push(`cli_execution_scope_mismatch:${row.recordingId}`); continue;
    }
    if (row.input.command !== 'apply' && row.input.command !== 'arrange') { exclude('not-layout-write-command'); continue; }
    if (!row.input.locator || !input.scope.locators.includes(row.input.locator)) {
      diagnostics.push(`cli_target_unattributed:${row.recordingId}`); continue;
    }
    if (row.input.requestId.state !== 'explicit' || row.input.dryRun.value === null) {
      diagnostics.push(`cli_request_flags_ambiguous:${row.recordingId}`); continue;
    }
    if (!row.result || row.threw) { exclude('original-execution-threw-layout-unknown'); continue; }
    let value: unknown;
    try { value = JSON.parse(row.result.stdout); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; diagnostics.push(`cli_response_not_json:${row.recordingId}`); continue; }
    const response = admitCanvasTraceResponse(value);
    if (response.kind === 'unknown') { diagnostics.push(`cli_response_unknown:${row.recordingId}`); continue; }
    if (row.result.exitCode !== 0) { exclude('failed-response-layout-unknown'); continue; }
    if (response.kind !== 'committed') { exclude(response.kind === 'dry-run' ? 'dry-run' : 'not-committed-layout-unknown'); continue; }
    const requestId = row.input.requestId.value;
    if (row.input.dryRun.value || response.value.requestId !== requestId) {
      diagnostics.push(`cli_request_response_mismatch:${row.recordingId}`); continue;
    }
    if (response.value.replayed === true) { exclude('replayed-no-new-computation'); continue; }
    if (response.value.replayed !== false) { diagnostics.push(`cli_freshness_missing:${requestId}`); continue; }
    const commit = CanvasCommitResultSchema.parse({ documentId: input.scope.documentId, requestId,
      sequence: response.value.sequence, refs: response.value.refs, results: response.value.results });
    const previous = commits.get(requestId);
    if (previous && !isDeepStrictEqual(previous, commit)) { diagnostics.push(`cli_commit_conflict:${requestId}`); continue; }
    commits.set(requestId, commit);
    commitSources.push({ origin: 'backend-cli-observation', requestId, sequence: commit.sequence, invocationId: row.invocationId,
      recordingId: row.recordingId, runId: identity.agentRunId, sourceFiles: row.sourceFiles });
    const computation = response.value.computation;
    if (computation) {
      if (computation.requestId !== requestId || computation.sequence > commit.sequence) diagnostics.push(`cli_computation_unattributed:${requestId}`);
      else layoutComputations.push({ origin: 'backend-cli-observation', invocationId: row.invocationId, recordingId: row.recordingId,
        runId: identity.agentRunId, commitSequence: commit.sequence, computation, sourceFiles: row.sourceFiles });
    } else if (computation === null && row.input.command === 'apply') {
      // reader已核61 producer源字节/正式build/实际compiled SHA；这里只接受明确fresh null。
      freshWithoutLayout.push({ origin: 'backend-cli-observation', requestId, invocationId: row.invocationId, runId: identity.agentRunId, sourceFiles: row.sourceFiles });
    } else diagnostics.push(`cli_computation_coverage_missing:${requestId}`);
  }
  return { label: { origin: 'backend-cli-observation', performanceQualification: 'observed-task-conservative-latency-only',
    observationSourceRevision: activation.observationSourceRevision, originalBackendSha256: activation.originalBackendSha256, wrapperSha256: activation.wrapperSha256 },
    commits: [...commits.values()], commitSources, layoutComputations, freshWithoutLayout, excluded, diagnostics, evidenceFiles: observation.evidenceFiles };
}
