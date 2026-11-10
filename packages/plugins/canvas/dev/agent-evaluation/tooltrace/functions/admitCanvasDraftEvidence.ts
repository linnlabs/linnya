import { ConversationControlResultResponseSchema } from '@app/schemas';
import {
  CanvasTraceControlsEvidenceSchema,
  CanvasTraceMetricsEvidenceSchema,
  type CanvasTraceWitnessScope,
} from '../definitions/traceDraft';

export function readCanvasDraftFinishedAt(
  value: unknown,
  scope: CanvasTraceWitnessScope
): number | undefined {
  const parsed = ConversationControlResultResponseSchema.safeParse(value);
  if (!parsed.success) return;
  const result = parsed.data;
  if (result.conversation_id !== scope.conversationId || result.run_id !== scope.runId) return;
  if (result.result_status === 'unavailable' && result.reason === 'run_not_completed') return;
  return result.completed_at;
}

export function admitCanvasDraftWitnesses(input: {
  readonly controls: unknown;
  readonly metrics: unknown;
  readonly scope: CanvasTraceWitnessScope;
}) {
  const controls =
    input.controls === undefined
      ? undefined
      : CanvasTraceControlsEvidenceSchema.parse(input.controls);
  const metrics =
    input.metrics === undefined ? undefined : CanvasTraceMetricsEvidenceSchema.parse(input.metrics);
  for (const witness of [controls, metrics]) {
    if (!witness) continue;
    const expected = input.scope,
      actual = witness.scope;
    if (
      expected.sourceRevision !== actual.sourceRevision ||
      expected.batchId !== actual.batchId ||
      expected.documentId !== actual.documentId ||
      expected.conversationId !== actual.conversationId ||
      expected.runId !== actual.runId
    )
      throw new Error('Independent witness belongs to another evaluation run');
  }
  return { controls, metrics };
}
