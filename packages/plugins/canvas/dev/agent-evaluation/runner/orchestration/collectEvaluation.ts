import { randomUUID } from 'node:crypto';
import {
  CanvasEvaluationCollectionSchema,
  type EvaluationRunnerPorts,
} from '../definitions/evaluationRunner';
import { readEvaluationSnapshot } from '../functions/readEvaluationSnapshot';
import { createEvidenceStep, readRunnerState, writeEvidence } from '../adapters/evidenceFiles';
import { collectEvaluationMessages } from './collectMessages';

export async function collectCanvasEvaluation(input: {
  readonly directory: string;
  readonly label: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  const state = await readRunnerState(input.directory);
  if (state.phase !== 'started' || !state.receipt || !state.connectionFile)
    throw new Error('No confirmed model run to collect');
  const directory = await createEvidenceStep(input.directory, input.label),
    connectionFile = state.connectionFile;
  const errors: string[] = [];
  let messagesComplete = false,
    sourceValid = true;
  // 来源改变也要保留首败的原始事实，但该批标记无效，绝不能混入后续修复后的样本。
  try {
    await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  } catch (error) {
    sourceValid = false;
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const { conversation_id: conversationId, run_id: runId } = state.receipt;
  const cli = async (label: string, args: readonly string[]) => {
    const response = await input.ports.cli({
      repositoryRoot: state.config.repositoryRoot,
      directory,
      label,
      args,
    });
    if (response.exitCode !== 0) throw new Error(`${label} CLI exited ${response.exitCode}`);
  };
  const results = await Promise.allSettled([
    cli('status', ['status', conversationId, '--run', runId]),
    cli('audit', ['audit', conversationId, '--run', runId]),
    cli('result', ['result', conversationId, '--run', runId]),
    (async () => {
      messagesComplete = await collectEvaluationMessages({
        conversationId,
        repositoryRoot: state.config.repositoryRoot,
        directory,
        ports: input.ports,
      });
    })(),
    (async () => {
      const raw = await input.ports.bridge({
        connectionFile,
        projectId: state.projectId,
        directory,
        label: 'after',
        command: { id: randomUUID(), kind: 'read', payload: {} },
      });
      const after = readEvaluationSnapshot(raw, state.documentId);
      await writeEvidence(directory, 'after.json', after);
      await input.ports.bridge({
        connectionFile,
        projectId: state.projectId,
        directory,
        label: 'stats',
        command: { id: randomUUID(), kind: 'stats', payload: {} },
      });
    })(),
  ]);
  for (const result of results)
    if (result.status === 'rejected')
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  try {
    await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  } catch (error) {
    sourceValid = false;
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const summary = CanvasEvaluationCollectionSchema.parse({
    sourceRevision: state.config.sourceRevision,
    batchId: state.config.batchId,
    collectedAt: Date.now(),
    taskId: state.config.taskId,
    conversationId,
    runId,
    errors,
    sourceValid,
    messagesComplete,
    evidenceComplete: !errors.length && messagesComplete,
    scoring: 'not-performed',
    manualActions:
      state.config.taskId === 'T9'
        ? 'Actual UI allow and screenshots required'
        : state.config.taskId === 'T12'
          ? 'Actual UI deny and screenshots required'
          : state.config.taskId === 'T11'
            ? 'Real keyboard draft and edit claim evidence required'
            : null,
  });
  await writeEvidence(directory, 'collection.json', summary);
  return { directory, ...summary };
}
