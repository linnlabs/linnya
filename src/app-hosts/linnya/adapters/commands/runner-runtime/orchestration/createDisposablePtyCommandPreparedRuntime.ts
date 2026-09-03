import {
  CommandRunnerInteractionIdSchema,
  parseCommandExecutionTerminal,
  parseCommandRunnerRequest,
  type CommandExecutionTerminalV1,
  type CommandRunnerEventV1,
  type CommandRunnerInteractionId,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';
import type {
  CommandExecutionInteractionCapability,
  CommandExecutionInteractionSettlement,
} from '../../../../../../domains/commands';
import {
  projectPtyCommandSettledTextOutput,
  projectUnavailablePtyCommandSettledTextOutput,
  type PtyCommandOutputSettlement,
} from '../../output';
import {
  DEFAULT_COMMAND_RUNNER_CLOSE_DEADLINE_MS,
  DEFAULT_COMMAND_RUNNER_START_HANDSHAKE_DEADLINE_MS,
} from '../definitions/disposablePipeCommandPreparedRuntime';
import {
  DisposablePtyCommandInteractionError,
  type DisposablePtyCommandOutputSink,
  type DisposablePtyCommandPreparedRuntime,
  type DisposablePtyCommandPreparedRuntimeInput,
} from '../definitions/disposablePtyCommandPreparedRuntime';
import {
  createDisposableRunnerHostLifecycle,
  deriveRunnerPostStartInterventionDeadlineMs,
  requireRunnerDeadline,
} from '../shared/disposableRunnerHostLifecycle';

interface PendingInteraction {
  readonly action: Extract<CommandRunnerRequestV1, {
    readonly kind: 'command_runner_interaction';
  }>['action'];
  readonly promise: Promise<CommandExecutionInteractionSettlement>;
  resolve(value: CommandExecutionInteractionSettlement): void;
  reject(error: unknown): void;
}

function pendingInteraction(
  action: PendingInteraction['action'],
): PendingInteraction {
  let resolvePromise: (value: CommandExecutionInteractionSettlement) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<CommandExecutionInteractionSettlement>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { action, promise, resolve: resolvePromise, reject: rejectPromise };
}

interface OutputSettlementDeferred {
  readonly promise: Promise<PtyCommandOutputSettlement>;
  resolve(value: PtyCommandOutputSettlement): void;
  reject(error: unknown): void;
}

function outputSettlementDeferred(): OutputSettlementDeferred {
  let resolvePromise: (value: PtyCommandOutputSettlement) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<PtyCommandOutputSettlement>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createPtyPrelaunchFailureTerminal(input: {
  readonly identity: DisposablePtyCommandPreparedRuntimeInput['launch']['proposal']['identity'];
  readonly settledAtMs: number;
  readonly failureCode: 'runtime_unavailable' | 'internal_failure';
}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'runtime_failure',
    failure: { code: input.failureCode },
    process_exit: { status: 'not_started' },
    output_drain: { status: 'not_started' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'not_required' },
  });
}

function createPtyRuntimeLostTerminal(input: {
  readonly identity: DisposablePtyCommandPreparedRuntimeInput['launch']['proposal']['identity'];
  readonly settledAtMs: number;
  readonly candidate?: CommandExecutionTerminalV1;
  readonly resourceRelease: 'succeeded' | 'failed';
}): CommandExecutionTerminalV1 {
  const candidateStarted = input.candidate
    && input.candidate.process_exit.status !== 'not_started';
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'runtime_failure',
    failure: { code: 'runtime_lost' },
    process_exit: candidateStarted
      ? input.candidate?.process_exit
      : { status: 'unavailable', reason: 'runtime_lost' },
    output_drain: { status: 'failed', code: 'output_drain_failed', reason: 'runtime_lost' },
    tree_cleanup: candidateStarted
      ? input.candidate?.tree_cleanup
      : { status: 'failed', code: 'tree_cleanup_failed' },
    resource_release: input.resourceRelease === 'failed'
      ? { status: 'failed', code: 'resource_release_failed' }
      : candidateStarted
        ? input.candidate?.resource_release
        : { status: 'succeeded' },
  });
}

function requireFailedResourceRelease(
  terminal: CommandExecutionTerminalV1,
): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    ...terminal,
    resource_release: { status: 'failed', code: 'resource_release_failed' },
  });
}

/** PTY feature 只保留 terminal 单流和 interaction identity；helper 生命周期由 shared 统一。 */
export function createDisposablePtyCommandPreparedRuntime(
  input: DisposablePtyCommandPreparedRuntimeInput,
): DisposablePtyCommandPreparedRuntime {
  const startRequest = parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: input.launch,
    ...(input.internalEnvironment
      ? { internal_environment: input.internalEnvironment }
      : {}),
  });
  if (startRequest.kind !== 'command_runner_start' || startRequest.launch.mode !== 'pty') {
    throw new Error('PTY command runner prepared runtime requires a PTY start request');
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
  const pending = new Map<CommandRunnerInteractionId, PendingInteraction>();
  const outputSettlement = outputSettlementDeferred();
  void outputSettlement.promise.catch(() => undefined);
  const settledTextOutput = outputSettlement.promise.then(
    projectPtyCommandSettledTextOutput,
    projectUnavailablePtyCommandSettledTextOutput,
  );
  let nextInteractionId = 0;
  let outputSink: DisposablePtyCommandOutputSink | undefined;

  function requireOutputSink(): DisposablePtyCommandOutputSink {
    if (!outputSink) throw new Error('PTY output sink is not open');
    return outputSink;
  }

  function rejectPending(code: 'stdin_closed' | 'interaction_failed'): void {
    if (pending.size === 0) return;
    const error = new DisposablePtyCommandInteractionError(code);
    for (const interaction of pending.values()) interaction.reject(error);
    pending.clear();
  }

  function acceptInteractionResult(event: Extract<
    CommandRunnerEventV1,
    { readonly kind: 'command_runner_interaction_result' }
  >): boolean {
    const interaction = pending.get(event.interaction_id);
    if (!interaction) return false;
    pending.delete(event.interaction_id);
    if (event.result.status === 'accepted') {
      if (interaction.action.type === 'resize') {
        requireOutputSink().acceptResize({
          columns: interaction.action.columns,
          rows: interaction.action.rows,
        });
      }
      interaction.resolve();
    }
    else interaction.resolve({ status: 'rejected', code: event.result.code });
    return true;
  }

  const host = createDisposableRunnerHostLifecycle<PtyCommandOutputSettlement>({
    identity: input.launch.proposal.identity,
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
      return requireOutputSink().acceptStarted(event);
    },
    acceptModeEvent(event) {
      if (event.kind === 'command_runner_pty_output') {
        return requireOutputSink().acceptOutput(event);
      }
      return event.kind === 'command_runner_interaction_result'
        && acceptInteractionResult(event);
    },
    acceptTerminal: event => event.output_sources?.mode !== 'pipe',
    onInteractionClosing: rejectPending,
    settlement: {
      settleBeforeSourceStart(settlementInput) {
        return settlementInput.kind === 'termination'
          ? requireOutputSink().settleBeforeSourceStartTermination({
              settledAtMs: now(),
              cause: settlementInput.cause,
            })
          : requireOutputSink().settleBeforeSourceStart({
              settledAtMs: now(),
              failureCode: settlementInput.failureCode,
            });
      },
      settleRunnerTerminal(event, sealedAtMs) {
        return requireOutputSink().settleRunnerTerminal({ event, sealedAtMs });
      },
      settleRuntimeLoss(runtimeLoss) {
        const settlement = requireOutputSink().settleRuntimeLoss(runtimeLoss);
        return runtimeLoss.resourceRelease === 'failed'
          ? settlement.then(value => Object.freeze({
              ...value,
              terminal: requireFailedResourceRelease(value.terminal),
            }))
          : settlement;
      },
      terminalOf: settlement => settlement.terminal,
      runtimeLostFallback: runtimeLoss => createPtyRuntimeLostTerminal({
        identity: input.launch.proposal.identity,
        ...runtimeLoss,
      }),
      onSettlementSucceeded: outputSettlement.resolve,
      onSettlementFailed: outputSettlement.reject,
    },
  });

  function sendInteraction(
    action: Extract<CommandRunnerRequestV1, {
      readonly kind: 'command_runner_interaction';
    }>['action'],
  ): Promise<CommandExecutionInteractionSettlement> {
    if (!host.isInteractionOpen()) {
      return Promise.reject(new DisposablePtyCommandInteractionError('stdin_closed'));
    }
    const id = CommandRunnerInteractionIdSchema.parse(nextInteractionId);
    nextInteractionId += 1;
    const request = parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_interaction',
      identity: input.launch.proposal.identity,
      interaction_id: id,
      action,
    });
    if (request.kind !== 'command_runner_interaction') {
      return Promise.reject(new DisposablePtyCommandInteractionError('interaction_failed'));
    }
    const interaction = pendingInteraction(request.action);
    pending.set(id, interaction);
    // send 只确认 helper transport 接收；匹配 result 才能结算业务 Promise。
    void host.send(request).catch(() => host.failProtocol());
    return interaction.promise;
  }

  const interaction: CommandExecutionInteractionCapability = Object.freeze({
    kind: 'pty',
    write: value => sendInteraction({ type: 'write', input: value }),
    submit: value => sendInteraction({ type: 'submit', input: value }),
    eof: () => sendInteraction({ type: 'eof' }),
    resize: size => sendInteraction({ type: 'resize', ...size }),
  });

  async function start() {
    host.beginStart();
    try {
      outputSink = await input.output.open();
    } catch (error: unknown) {
      outputSettlement.reject(error);
      host.settlePrelaunchFailure(createPtyPrelaunchFailureTerminal({
        identity: input.launch.proposal.identity,
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
    outputSettlement: outputSettlement.promise,
    settledTextOutput,
    interaction,
    outputObservation: input.output.observation,
    start,
    stopAndWait: host.stop,
  });
}
