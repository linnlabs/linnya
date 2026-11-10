import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConversationControlSendResponseSchema } from '@app/schemas';
import type { EvaluationRunnerPorts } from '../definitions/evaluationRunner';
import {
  readRunnerState,
  readEvidence,
  createEvidenceStep,
  updateRunnerState,
  writeEvidence,
} from '../adapters/evidenceFiles';
import { admitApprovalContinuation } from '../functions/admitApprovalContinuation';
import { readEvaluationRunReceipts } from '../functions/readEvaluationRunReceipts';
import { assertApprovalPriorRun } from '../functions/assertApprovalPriorRun';

/** 此入口仅通知真实审批结果，不批准操作、不改原任务，也不能作为失败重试。 */
export async function continueCanvasApprovalEvaluation(input: {
  readonly directory: string;
  readonly controlsFile: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  const state = await readRunnerState(input.directory);
  const approval = admitApprovalContinuation(state, await readEvidence(input.controlsFile));
  const [first] = readEvaluationRunReceipts(state);
  await Promise.all(approval.witness.evidenceFiles.map(file => access(file)));
  await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  // 尚未发送的只读预检独立留痕；原run仍running时不占用唯一发送身份。
  const preflight = await createEvidenceStep(input.directory, 'approval-preflight-' + randomUUID());
  const status = await input.ports.cli({
    repositoryRoot: state.config.repositoryRoot,
    directory: preflight,
    label: 'prior-status',
    args: ['status', first.conversation_id, '--run', first.run_id],
  });
  if (status.exitCode !== 0)
    throw new Error('Prior run status is unavailable; retain evidence and do not resend');
  assertApprovalPriorRun(state, status.value);
  // 从这里开始消息可能已发出：响应未知或落盘失败也不能删除目录后重发。
  const directory = await createEvidenceStep(input.directory, 'approval-continuation');
  const witnessFile = path.join(directory, 'approval-witness.json'),
    priorStatusFile = path.join(preflight, 'prior-status.response.json');
  await writeEvidence(directory, 'approval-witness.json', approval.witness);
  await writeEvidence(directory, 'continuation-request.json', {
    controlsFile: input.controlsFile,
    decision: approval.decision,
    priorStatusFile,
  });
  await writeFile(path.join(directory, 'prompt.txt'), approval.prompt, { flag: 'wx', mode: 0o600 });
  const startedAt = Date.now();
  const response = await input.ports.cli({
    repositoryRoot: state.config.repositoryRoot,
    directory,
    label: 'send',
    args: [
      'send',
      approval.prompt,
      '--conversation',
      first.conversation_id,
      '--project',
      state.projectId,
      '--model',
      state.config.modelConfigId,
      '--reasoning',
      'high',
    ],
  });
  if (response.exitCode !== 0)
    throw new Error('Continuation send was not confirmed; retain evidence and do not resend');
  const receipt = ConversationControlSendResponseSchema.parse(response.value).receipt;
  const next = {
    ...state,
    continuations: [
      {
        step: 'approval-continuation' as const,
        decision: approval.decision,
        witnessFile,
        priorStatusFile,
        startedAt,
        receipt,
      },
    ],
  };
  readEvaluationRunReceipts(next);
  await updateRunnerState(input.directory, next);
  return { receipt, decision: approval.decision, originalRunId: first.run_id };
}
