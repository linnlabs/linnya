import type { ConversationControlRunStatusSnapshot } from '@app/schemas';
import type {
  BenchmarkConversationCliPort,
} from '../definitions/conversationCliPort';
import { BenchmarkConversationCliError } from '../definitions/conversationCliPort';
import type {
  BenchmarkRunError,
  BenchmarkRunFacts,
  BenchmarkRunOutcome,
  RunBenchmarkCaseRequest,
} from '../definitions/benchmarkRun';
import { summarizeConversationMessages } from '../functions/summarizeConversationMessages';

interface RunBenchmarkCaseOptions {
  readonly cli: BenchmarkConversationCliPort;
  readonly now?: () => number;
}

function projectError(stage: string, error: unknown): BenchmarkRunError {
  if (error instanceof BenchmarkConversationCliError) {
    return {
      stage,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    stage,
    code: 'runner_internal_error',
    message: error instanceof Error ? error.message : 'Unknown Benchmark runner error',
    retryable: false,
  };
}

function terminalOutcome(
  snapshot: ConversationControlRunStatusSnapshot,
): BenchmarkRunOutcome | undefined {
  switch (snapshot.status) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'pending':
    case 'running':
    case 'awaiting_user':
      return undefined;
  }
}

export async function runBenchmarkCase(
  request: RunBenchmarkCaseRequest,
  options: RunBenchmarkCaseOptions,
): Promise<BenchmarkRunFacts> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const statusFrames: BenchmarkRunFacts['statusFrames'][number][] = [];
  const interactionResponses: BenchmarkRunFacts['interactionResponses'][number][] = [];
  const errors: BenchmarkRunError[] = [];
  const reasoningEffort = request.reasoningEffort
    ?? request.benchmark.definition.reasoningEffort;
  let receipt: BenchmarkRunFacts['receipt'];
  let stop: BenchmarkRunFacts['stop'];
  let result: BenchmarkRunFacts['result'];
  let messages: BenchmarkRunFacts['messages'];
  let audit: BenchmarkRunFacts['audit'] = { status: 'not_requested' };
  let outcome: BenchmarkRunOutcome = 'runner_failed';
  let lastSnapshot: ConversationControlRunStatusSnapshot | null | undefined;

  try {
    receipt = await options.cli.send({
      message: request.benchmark.prompt,
      projectId: request.projectId,
      agentId: request.benchmark.definition.agentId,
      modelId: request.modelId,
      reasoningEffort,
    });
    const deadline = startedAt + request.benchmark.definition.timeoutMs;
    let responseCount = 0;

    while (true) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        stop = await options.cli.stop({
          conversationId: receipt.conversation_id,
          runId: receipt.run_id,
          reason: 'Benchmark timeout',
        });
        outcome = stop.outcome;
        break;
      }
      const watched = await options.cli.watchStatus({
        conversationId: receipt.conversation_id,
        runId: receipt.run_id,
        timeoutMs: remainingMs,
      });
      statusFrames.push(...watched.frames);
      lastSnapshot = watched.frames.at(-1)?.snapshot;
      if (watched.timedOut) {
        stop = await options.cli.stop({
          conversationId: receipt.conversation_id,
          runId: receipt.run_id,
          reason: 'Benchmark timeout',
        });
        outcome = stop.outcome;
        break;
      }
      if (!lastSnapshot) {
        throw new Error(`Run ${receipt.run_id} was not visible to status`);
      }
      const terminal = terminalOutcome(lastSnapshot);
      if (terminal) {
        outcome = terminal;
        break;
      }
      if (lastSnapshot.status !== 'awaiting_user') continue;
      const interaction = lastSnapshot.pending_interaction;
      if (
        request.benchmark.definition.interaction.awaitingUser === 'manual'
        || responseCount >= request.benchmark.definition.interaction.maxResponses
        || !interaction
      ) {
        outcome = 'requires_user';
        break;
      }
      interactionResponses.push(await options.cli.approve({
        conversationId: receipt.conversation_id,
        interactionId: interaction.interaction_id,
        projectId: request.projectId,
      }));
      responseCount += 1;
    }
  } catch (error: unknown) {
    errors.push(projectError(receipt ? 'execution' : 'send', error));
    if (receipt && outcome === 'runner_failed') {
      try {
        stop = await options.cli.stop({
          conversationId: receipt.conversation_id,
          runId: receipt.run_id,
          reason: 'Benchmark runner failed',
        });
        outcome = stop.outcome;
      } catch (stopError: unknown) {
        errors.push(projectError('stop_after_failure', stopError));
      }
    }
  }

  if (receipt && outcome !== 'requires_user' && outcome !== 'runner_failed') {
    try {
      result = await options.cli.result(receipt.conversation_id, receipt.run_id);
    } catch (error: unknown) {
      errors.push(projectError('result', error));
    }
  }
  if (receipt) {
    try {
      messages = summarizeConversationMessages(await options.cli.messages(receipt.conversation_id));
    } catch (error: unknown) {
      errors.push(projectError('messages', error));
    }
    try {
      audit = {
        status: 'available',
        response: await options.cli.audit(receipt.conversation_id, receipt.run_id),
      };
    } catch (error: unknown) {
      const projected = projectError('audit', error);
      audit = {
        status: 'unavailable',
        code: projected.code,
        message: projected.message,
      };
      if (projected.code !== 'capability_unavailable') errors.push(projected);
    }
  }

  const finishedAt = now();
  return {
    schemaVersion: 1,
    benchmark: {
      id: request.benchmark.definition.id,
      revision: request.benchmark.definition.revision,
      name: request.benchmark.definition.name,
      tags: request.benchmark.definition.tags,
      artifactExpectation: request.benchmark.definition.artifactExpectation,
    },
    configuration: {
      projectId: request.projectId,
      agentId: request.benchmark.definition.agentId,
      modelId: request.modelId,
      reasoningEffort,
      timeoutMs: request.benchmark.definition.timeoutMs,
      inputs: request.benchmark.inputs,
    },
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    outcome,
    receipt,
    statusFrames,
    interactionResponses,
    stop,
    result,
    messages,
    audit,
    errors,
  };
}
