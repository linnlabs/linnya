import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConversationControlSendResponseSchema } from '@app/schemas';
import type { EvaluationRunnerPorts } from '../definitions/evaluationRunner';
import { readEvaluationSnapshot } from '../functions/readEvaluationSnapshot';
import {
  createEvidenceStep,
  readRunnerState,
  updateRunnerState,
  writeEvidence,
} from '../adapters/evidenceFiles';
export async function startCanvasEvaluation(input: {
  readonly directory: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  const state = await readRunnerState(input.directory);
  if (state.phase !== 'attached' || !state.connectionFile)
    throw new Error('Attach and seed the evaluation first');
  await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  const directory = await createEvidenceStep(input.directory, 'start'),
    connectionFile = state.connectionFile;
  const bridge = (
    label: string,
    command: Parameters<EvaluationRunnerPorts['bridge']>[0]['command']
  ) =>
    input.ports.bridge({ connectionFile, projectId: state.projectId, directory, label, command });
  const before = readEvaluationSnapshot(
    await bridge('before', { id: randomUUID(), kind: 'read', payload: {} }),
    state.documentId
  );
  await writeEvidence(input.directory, 'before.json', before);
  await bridge('stats-reset', { id: randomUUID(), kind: 'stats', payload: { reset: true } });
  const prompt = await readFile(path.join(input.directory, 'prompt.txt'), 'utf8'),
    startedAt = Date.now();
  const result = await input.ports.cli({
    repositoryRoot: state.config.repositoryRoot,
    directory,
    label: 'send',
    args: [
      'send',
      prompt,
      '--project',
      state.projectId,
      '--model',
      state.config.modelConfigId,
      '--reasoning',
      'high',
    ],
  });
  if (result.exitCode !== 0)
    throw new Error(
      'Send was not confirmed. Retain the evidence; do not automatically resend an uncertain request.'
    );
  const response = ConversationControlSendResponseSchema.parse(result.value);
  await updateRunnerState(input.directory, {
    ...state,
    phase: 'started',
    receipt: response.receipt,
    startedAt,
  });
  return { phase: 'started', receipt: response.receipt, taskId: state.config.taskId };
}
