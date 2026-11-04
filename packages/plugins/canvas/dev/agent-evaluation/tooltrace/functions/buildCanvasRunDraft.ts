import { CanvasAgentEvaluationRunSchema } from '../../../../scripts/agent-evaluation';
import type { CanvasRunDraftInput } from '../definitions/traceDraft';
import { readCanvasImageReadSequence } from './readCanvasImageReadSequence';
import { admitCanvasDraftSource } from './admitCanvasDraftSource';
import { admitCanvasDraftWitnesses, readCanvasDraftFinishedAt } from './admitCanvasDraftEvidence';

/** 缺事实就产出partial，不把人工动作、未知纠错或未完成run补成成功。 */
export function buildCanvasRunDraft(input: CanvasRunDraftInput) {
  const { state, collection, before, after, scope, startedAt } = admitCanvasDraftSource(input);
  const config = state.config,
    diagnostics: string[] = [];
  if (!collection.sourceValid || !collection.messagesComplete || !collection.evidenceComplete)
    diagnostics.push('collection_incomplete_or_source_changed');
  if (input.facts.needsReview) diagnostics.push('tooltrace_needs_review');
  const finishedAt = readCanvasDraftFinishedAt(input.result, scope);
  if (finishedAt === undefined) diagnostics.push('run_terminal_result_missing');
  const check = [...input.facts.checks]
    .reverse()
    .find(value => value.report.sequence === after.sequence)?.report;
  if (!check) diagnostics.push('final_sequence_check_missing');
  const { controls, metrics } = admitCanvasDraftWitnesses({
    controls: input.controls,
    metrics: input.metrics,
    scope,
  });
  if (!controls) diagnostics.push('trusted_ui_controls_missing');
  const imageReadSequence = readCanvasImageReadSequence(input.facts);
  if (imageReadSequence === undefined) diagnostics.push('image_read_render_link_missing');
  const attempts = [
    ...input.facts.attempts.map(value => ({ ...value, phase: 'write' })),
    ...input.facts.dryRuns.map(value => ({ ...value, phase: 'dry-run' })),
  ]
    .sort((a, b) => a.order - b.order)
    .map(value => ({
      phase: value.phase,
      requestId: value.requestId,
      validationAccepted: value.validationAccepted,
      correction: value.correction,
      responseFile: value.sourceFile,
    }));
  const candidate = {
    fixtureVersion: 1,
    taskId: config.taskId,
    sourceRevision: config.sourceRevision,
    batchId: config.batchId,
    model: config.model,
    imageCapability: config.imageCapability,
    evidenceMode: config.evidenceMode,
    repetition: config.repetition,
    startedAt,
    finishedAt,
    before,
    after,
    check,
    documentIds: state.documentIds,
    attempts,
    commits: input.facts.commits,
    controls: controls && {
      approvalShown: controls.approvalShown,
      approvalDecision: controls.approvalDecision,
      editedCardId: controls.editedCardId,
      renderCount: input.facts.renders.length,
      imageReadCount: input.facts.imageReads.length,
      imageReadSequence: imageReadSequence ?? null,
    },
    metrics: metrics?.metrics ?? {},
    evidenceFiles: [
      ...input.evidenceFiles,
      ...(controls?.evidenceFiles ?? []),
      ...(metrics?.evidenceFiles ?? []),
    ],
  };
  const parsed = CanvasAgentEvaluationRunSchema.safeParse(candidate);
  if (!parsed.success)
    diagnostics.push(
      ...parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    );
  return parsed.success && !diagnostics.length
    ? { kind: 'ready-for-review' as const, run: parsed.data, diagnostics }
    : { kind: 'needs-evidence' as const, partial: candidate, diagnostics };
}
