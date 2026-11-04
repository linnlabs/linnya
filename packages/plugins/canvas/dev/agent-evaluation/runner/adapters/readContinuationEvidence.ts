import { isDeepStrictEqual } from 'node:util';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { ConversationControlSendResponseSchema } from '@app/schemas';
import type { CanvasEvaluationRunnerState } from '../definitions/evaluationRunner';
import { admitApprovalWitness } from '../functions/admitApprovalContinuation';
import { readEvaluationRunReceipts } from '../functions/readEvaluationRunReceipts';
import { readEvidence } from './evidenceFiles';
import { assertApprovalPriorRun } from '../functions/assertApprovalPriorRun';

/** 草拟或补回执时重新核对真实send原件和UI见证，不能只信state中的run编号。 */
export async function readEvaluationContinuationEvidence(state: CanvasEvaluationRunnerState) {
  readEvaluationRunReceipts(state);
  const evidenceFiles: string[] = [];
  for (const continuation of state.continuations ?? []) {
    const approval = admitApprovalWitness(state, await readEvidence(continuation.witnessFile));
    if (approval.decision !== continuation.decision)
      throw new Error('Continuation UI decision changed');
    const responseFile = path.join(path.dirname(continuation.witnessFile), 'send.response.json');
    const directory = path.dirname(continuation.witnessFile),
      statusFile = continuation.priorStatusFile;
    assertApprovalPriorRun(state, await readEvidence(statusFile));
    const response = ConversationControlSendResponseSchema.parse(await readEvidence(responseFile));
    if (!isDeepStrictEqual(response.receipt, continuation.receipt))
      throw new Error('Continuation receipt conflicts with original send evidence');
    evidenceFiles.push(
      continuation.witnessFile,
      responseFile,
      statusFile,
      path.join(directory, 'send.request.json'),
      path.join(directory, 'prompt.txt'),
      path.join(directory, 'continuation-request.json'),
      ...approval.witness.evidenceFiles
    );
  }
  await Promise.all(evidenceFiles.map(file => access(file)));
  return evidenceFiles;
}
