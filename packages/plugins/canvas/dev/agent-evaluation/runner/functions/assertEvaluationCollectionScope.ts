import { isDeepStrictEqual } from 'node:util';
import type {
  CanvasEvaluationCollection,
  CanvasEvaluationRunnerState,
} from '../definitions/evaluationRunner';
import { readEvaluationRunReceipts } from './readEvaluationRunReceipts';

export function assertEvaluationCollectionScope(
  state: CanvasEvaluationRunnerState,
  collection: CanvasEvaluationCollection
) {
  const [first, ...continuations] = readEvaluationRunReceipts(state);
  if (
    collection.conversationId !== first.conversation_id ||
    collection.runId !== first.run_id ||
    collection.sourceRevision !== state.config.sourceRevision ||
    collection.batchId !== state.config.batchId ||
    collection.taskId !== state.config.taskId ||
    !isDeepStrictEqual(
      collection.continuationRunIds ?? [],
      continuations.map(receipt => receipt.run_id)
    )
  )
    throw new Error('Collection belongs to another evaluation run');
}
