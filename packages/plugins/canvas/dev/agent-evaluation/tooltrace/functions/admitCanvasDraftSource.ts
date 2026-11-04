import { CanvasSnapshotSchema } from '@plugin/canvas/shared';
import { isDeepStrictEqual } from 'node:util';
import {
  CanvasEvaluationRunnerStateSchema,
  CanvasEvaluationCollectionSchema,
  assertEvaluationCollectionScope,
  readEvaluationRunReceipts,
} from '../../runner';
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
  assertEvaluationCollectionScope(state, collection);
  const receipts = readEvaluationRunReceipts(state),
    finalRunId = state.continuations?.[0]?.receipt.run_id ?? receipt.run_id;
  if (
    input.facts.scope.documentId !== state.documentId ||
    input.facts.scope.conversationId !== scope.conversationId ||
    input.facts.scope.rootRunId !== scope.runId ||
    !isDeepStrictEqual(
      input.facts.scope.continuationRunIds ?? [],
      receipts.slice(1).map(receipt => receipt.run_id)
    )
  )
    throw new Error('Tool facts belong to another evaluation run');
  return { state, collection, before, after, scope, startedAt, finalRunId };
}
