import { setTimeout } from 'node:timers/promises';
import { ConversationControlStatusResponseSchema } from '@app/schemas';
import type { EvaluationRunnerPorts } from '../definitions/evaluationRunner';
import { createEvidenceStep, readRunnerState, writeEvidence } from '../adapters/evidenceFiles';
import { readEvaluationRunReceipts } from '../functions/readEvaluationRunReceipts';
export async function waitCanvasEvaluation(input: {
  readonly directory: string;
  readonly label: string;
  readonly timeoutMs: number;
  readonly ports: EvaluationRunnerPorts;
}) {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1000)
    throw new Error('Timeout must be an integer of at least 1000ms');
  const state = await readRunnerState(input.directory);
  if (!state.receipt) throw new Error('No confirmed model run');
  const [first] = readEvaluationRunReceipts(state),
    active = state.continuations?.[0]?.receipt ?? first;
  await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  const directory = await createEvidenceStep(input.directory, input.label),
    deadline = Date.now() + input.timeoutMs;
  let index = 0;
  while (true) {
    const response = await input.ports.cli({
      repositoryRoot: state.config.repositoryRoot,
      directory,
      label: `status-${++index}`,
      args: ['status', active.conversation_id, '--run', active.run_id],
    });
    if (response.exitCode !== 0)
      throw new Error('Status CLI failed; inspect the retained raw evidence');
    const run = ConversationControlStatusResponseSchema.parse(response.value).run;
    const terminal = run && ['completed', 'failed', 'cancelled'].includes(run.status);
    const needsUser = run && ['paused', 'awaiting_user'].includes(run.status);
    if (terminal || needsUser || Date.now() >= deadline) {
      const outcome = {
        status: run?.status ?? 'missing',
        terminal: Boolean(terminal),
        needsUser: Boolean(needsUser),
        timedOut: Date.now() >= deadline,
        observedAt: Date.now(),
      };
      await writeEvidence(directory, 'wait.json', outcome);
      return outcome;
    }
    await setTimeout(Math.min(5000, deadline - Date.now()));
  }
}
