import {
  hasSameCommandExecutionIdentity,
  parseCommandRunnerRequest,
  type CommandRunnerRequestV1,
  type PipeCommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import { CLOSED_COMMAND_EXECUTION_INTERACTION } from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
  DEFAULT_PIPE_COMMAND_OUTPUT_OBSERVATION_MAX_EVENTS,
} from '../../../../../../infra/adapters/command-runtime/output';
import {
  createPipeCommandOutputSession,
  createPipeCommandPrelaunchFailureTerminal,
  createPipeCommandRuntimeLostTerminal,
  projectPipeCommandSettledTextOutput,
  projectUnavailablePipeCommandSettledTextOutput,
  type PipeCommandOutputSession,
  type PipeCommandOutputSettlement,
} from '../../output';
import {
  DEFAULT_COMMAND_RUNNER_CLOSE_DEADLINE_MS,
  DEFAULT_COMMAND_RUNNER_START_HANDSHAKE_DEADLINE_MS,
  type DisposablePipeCommandPreparedRuntime,
  type DisposablePipeCommandPreparedRuntimeInput,
} from '../definitions/disposablePipeCommandPreparedRuntime';
import {
  createDisposableRunnerHostLifecycle,
  deriveRunnerPostStartInterventionDeadlineMs,
  requireRunnerDeadline,
} from '../shared/disposableRunnerHostLifecycle';

type PipeCommandRunnerStartRequest = Omit<
  Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>,
  'launch'
> & { readonly launch: PipeCommandLaunchSnapshotV1 };

function requireCommandRunnerStartRequest(
  request: CommandRunnerRequestV1,
): PipeCommandRunnerStartRequest {
  if (request.kind !== 'command_runner_start' || request.launch.mode !== 'pipe') {
    throw new Error('pipe command runner prepared runtime requires a pipe start request');
  }
  return { ...request, launch: request.launch };
}

interface OutputSettlementDeferred {
  readonly promise: Promise<PipeCommandOutputSettlement>;
  resolve(value: PipeCommandOutputSettlement): void;
  reject(error: unknown): void;
}

function outputSettlementDeferred(): OutputSettlementDeferred {
  let resolvePromise: (value: PipeCommandOutputSettlement) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<PipeCommandOutputSettlement>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/**
 * pipe feature 只负责双流 artifact/text/observation；helper transport、关闭期限和停止
 * 竞争统一交给 runner-runtime shared lifecycle，避免 pipe/PTY 各修一套宿主补丁。
 */
export function createDisposablePipeCommandPreparedRuntime(
  input: DisposablePipeCommandPreparedRuntimeInput,
): DisposablePipeCommandPreparedRuntime {
  const startRequest = requireCommandRunnerStartRequest(parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: input.launch,
    ...(input.internalEnvironment
      ? { internal_environment: input.internalEnvironment }
      : {}),
  }));
  if (!hasSameCommandExecutionIdentity(
    startRequest.launch.proposal.identity,
    input.artifactOwner.identity,
  )) {
    throw new Error('command runner launch and artifact owner identity must match');
  }
  const now = input.now ?? Date.now;
  const startHandshakeDeadlineMs = requireRunnerDeadline(
    input.startHandshakeDeadlineMs ?? DEFAULT_COMMAND_RUNNER_START_HANDSHAKE_DEADLINE_MS,
    'command runner start handshake deadline',
  );
  const closeDeadlineMs = requireRunnerDeadline(
    input.closeDeadlineMs ?? DEFAULT_COMMAND_RUNNER_CLOSE_DEADLINE_MS,
    'command runner close deadline',
  );
  const outputObservation = createBoundedPipeCommandOutputObservation({
    maxEvents: DEFAULT_PIPE_COMMAND_OUTPUT_OBSERVATION_MAX_EVENTS,
    maxCharacters: input.text.agentTextProjectionLimits.maxCharactersPerStream * 2,
  });
  const outputSettlement = outputSettlementDeferred();
  void outputSettlement.promise.catch(() => undefined);
  const settledTextOutput = outputSettlement.promise.then(
    projectPipeCommandSettledTextOutput,
    projectUnavailablePipeCommandSettledTextOutput,
  );
  let outputSession: PipeCommandOutputSession | undefined;

  function requireOutputSession(): PipeCommandOutputSession {
    if (!outputSession) throw new Error('pipe output session is not open');
    return outputSession;
  }

  const host = createDisposableRunnerHostLifecycle<PipeCommandOutputSettlement>({
    identity: input.artifactOwner.identity,
    startRequest,
    runnerProcess: input.runnerProcess,
    startHandshakeDeadlineMs,
    closeDeadlineMs,
    postStartInterventionDeadlineMs: deriveRunnerPostStartInterventionDeadlineMs({
      startHandshakeDeadlineMs,
      commandHardTimeoutMs: startRequest.launch.hard_timeout_ms,
      closeDeadlineMs,
    }),
    now,
    onDiagnostic: input.onDiagnostic,
    acceptStarted(event) {
      return requireOutputSession().acceptStarted(event).status === 'accepted';
    },
    acceptModeEvent(event) {
      return event.kind === 'command_runner_output'
        && requireOutputSession().acceptOutput(event).status === 'accepted';
    },
    acceptTerminal(event) {
      return event.output_sources?.mode !== 'pty';
    },
    settlement: {
      settleBeforeSourceStart(settlementInput) {
        return settlementInput.kind === 'termination'
          ? requireOutputSession().settleBeforeSourceStartTermination({
              settledAtMs: now(),
              cause: settlementInput.cause,
            })
          : requireOutputSession().settleBeforeSourceStart({
              settledAtMs: now(),
              failureCode: settlementInput.failureCode,
            });
      },
      settleRunnerTerminal(event, sealedAtMs) {
        return requireOutputSession().settleRunnerTerminal({ event, sealedAtMs });
      },
      settleRuntimeLoss(runtimeLoss) {
        return requireOutputSession().settleRuntimeLoss({
          settledAtMs: runtimeLoss.settledAtMs,
          resourceRelease: runtimeLoss.resourceRelease,
        });
      },
      terminalOf: settlement => settlement.terminal,
      runtimeLostFallback: runtimeLoss => createPipeCommandRuntimeLostTerminal({
        identity: input.artifactOwner.identity,
        settledAtMs: runtimeLoss.settledAtMs,
        resourceRelease: runtimeLoss.resourceRelease,
      }),
      onSettlementSucceeded: outputSettlement.resolve,
      onSettlementFailed: outputSettlement.reject,
    },
  });

  async function start() {
    host.beginStart();
    try {
      outputSession = await createPipeCommandOutputSession({
        owner: input.artifactOwner,
        artifactPort: input.artifactPort,
        text: {
          ...input.text,
          encoding: startRequest.launch.shell.output_text_encoding,
          observation: outputObservation,
        },
      });
    } catch (error: unknown) {
      outputSettlement.reject(error);
      host.settlePrelaunchFailure(createPipeCommandPrelaunchFailureTerminal({
        identity: input.artifactOwner.identity,
        settledAtMs: now(),
        failureCode: 'internal_failure',
      }));
      throw error;
    }
    host.startRunner();
    return host.startResult;
  }

  return Object.freeze({
    terminal: host.terminal,
    interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
    outputObservation,
    outputSettlement: outputSettlement.promise,
    settledTextOutput,
    start,
    stopAndWait: host.stop,
  });
}
