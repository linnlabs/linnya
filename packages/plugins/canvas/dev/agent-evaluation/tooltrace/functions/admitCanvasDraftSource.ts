import { CanvasSnapshotSchema } from '@plugin/canvas/shared';
import { CanvasEvaluationRunnerStateSchema, CanvasEvaluationCollectionSchema } from '../../runner';
import type { CanvasRunDraftInput } from '../definitions/traceDraft';

/** 源码批次、会话run和画布必须是同一组事实，不能把后采集或别题的快照拼接进来。 */
export function admitCanvasDraftSource(input: CanvasRunDraftInput) {
  const state = CanvasEvaluationRunnerStateSchema.parse(input.state),
    collection = CanvasEvaluationCollectionSchema.parse(input.collection);
  const before = CanvasSnapshotSchema.parse(input.before),
    after = CanvasSnapshotSchema.parse(input.after);
  const receipt = state.receipt,
    startedAt = state.startedAt;
  if (!receipt || startedAt === undefined) throw new Error('Evaluation has no confirmed model run');
  if (before.documentId !== state.documentId || after.documentId !== state.documentId)
    throw new Error('Snapshot belongs to another Canvas document');
  const scope = {
    sourceRevision: state.config.sourceRevision,
    batchId: state.config.batchId,
    documentId: state.documentId,
    conversationId: receipt.conversation_id,
    runId: receipt.run_id,
  };
  if (
    collection.sourceRevision !== scope.sourceRevision ||
    collection.batchId !== scope.batchId ||
    collection.taskId !== state.config.taskId ||
    collection.conversationId !== scope.conversationId ||
    collection.runId !== scope.runId
  )
    throw new Error('Collection belongs to another evaluation run');
  if (
    input.facts.scope.documentId !== state.documentId ||
    input.facts.scope.conversationId !== scope.conversationId ||
    input.facts.scope.rootRunId !== scope.runId
  )
    throw new Error('Tool facts belong to another evaluation run');
  return { state, collection, before, after, scope, startedAt };
}
