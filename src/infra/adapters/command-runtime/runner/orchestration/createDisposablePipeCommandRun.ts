import type { Readable } from 'node:stream';

import {
  CommandOutputSequenceSchema,
  MAX_COMMAND_OUTPUT_EVENT_BYTES,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionTerminalV1,
  type CommandOutputInterruptionReason,
  type CommandOwnerTerminationCause,
  type CommandPipeOutputChannel,
  type CommandRunnerPipeOutputSettlementV1,
  type CommandRunnerRequestV1,
  type PipeCommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import type {
  LaunchCommandRunnerOwnedPipeProcess,
} from '../definitions/commandRunnerOwnedPipeProcess';
import { CommandRunnerOwnedPipeProcessLaunchError } from '../definitions/commandRunnerOwnedPipeProcess';
import type { CommandRunnerEventTransport } from '../definitions/commandRunnerOutputTransport';
import type {
  OwnedPipeProcess,
} from '../../../../../shared/process-runtime';
import {
  createNotStartedCommandTerminal,
  createOwnedCommandLifecycle,
  observeCommandPromise,
} from '../shared/ownedCommandLifecycle';

type CommandRunnerStartRequestV1 = Extract<
  CommandRunnerRequestV1,
  { readonly kind: 'command_runner_start' }
>;

type PipeCommandRunnerStartRequestV1 = Omit<CommandRunnerStartRequestV1, 'launch'> & {
  readonly launch: PipeCommandLaunchSnapshotV1;
};

function isPipeCommandRunnerStartRequest(
  request: CommandRunnerStartRequestV1,
): request is PipeCommandRunnerStartRequestV1 {
  return request.launch.mode === 'pipe';
}

interface OutputStreamState {
  readonly channel: CommandPipeOutputChannel;
  nextSequence: number;
  observedBytes: number;
  settled: boolean;
  interruptionReason?: CommandOutputInterruptionReason;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
}

export interface DisposablePipeCommandRun {
  start(): Promise<void>;
  stop(cause: CommandOwnerTerminationCause): void;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

function createStreamState(channel: CommandPipeOutputChannel): OutputStreamState {
  return {
    channel,
    nextSequence: 0,
    observedBytes: 0,
    settled: false,
  };
}

function toOutputSettlement(
  state: OutputStreamState,
): CommandRunnerPipeOutputSettlementV1['stdout'] {
  const base = {
    next_sequence: CommandOutputSequenceSchema.parse(state.nextSequence),
    observed_bytes: state.observedBytes,
  };
  if (state.interruptionReason) {
    return {
      ...base,
      source_completion: 'interrupted',
      interruption_reason: state.interruptionReason,
    };
  }
  return { ...base, source_completion: 'complete' };
}

function createNotStartedTerminal(input: {
  readonly request: CommandRunnerStartRequestV1;
  readonly settledAtMs: number;
  readonly stopCause?: CommandOwnerTerminationCause;
  readonly launchError?: unknown;
}): CommandExecutionTerminalV1 {
  const launchError = input.launchError instanceof CommandRunnerOwnedPipeProcessLaunchError
    ? input.launchError
    : undefined;
  return createNotStartedCommandTerminal({
    identity: input.request.launch.proposal.identity,
    settledAtMs: input.settledAtMs,
    stopCause: input.stopCause,
    failureCode: launchError?.failureCode ?? 'launch_failed',
    cleanup: launchError?.settlement.status === 'startup_cleanup_observed'
      ? launchError.settlement
      : undefined,
  });
}

/**
 * 只编排一条普通 pipe execution。平台 owner 负责建立和证明进程树边界；本模块
 * 分别收集 root exit、双流排空、tree empty 与 release，任何一个事实都不能冒充另一个。
 */
export function createDisposablePipeCommandRun(input: {
  readonly request: CommandRunnerStartRequestV1;
  readonly events: CommandRunnerEventTransport;
  readonly launchOwnedProcess: LaunchCommandRunnerOwnedPipeProcess;
  readonly now?: () => number;
  readonly postTreeSettlementDeadlineMs?: number;
}): DisposablePipeCommandRun {
  if (!isPipeCommandRunnerStartRequest(input.request)) {
    throw new Error('disposable pipe command run requires a pipe start request');
  }
  const request = input.request;
  const now = input.now ?? Date.now;
  const postTreeSettlementDeadlineMs = input.postTreeSettlementDeadlineMs ?? 2_000;
  const identity = request.launch.proposal.identity;
  const stdout = createStreamState('stdout');
  const stderr = createStreamState('stderr');
  const streamSettlements = new Map<CommandPipeOutputChannel, Deferred<void>>([
    ['stdout', deferred<void>()],
    ['stderr', deferred<void>()],
  ]);
  const lifecycle = createOwnedCommandLifecycle({
    hardTimeoutMs: request.launch.hard_timeout_ms,
    postTreeSettlementDeadlineMs,
    releasePolicy: 'after_explicit_barrier',
  });
  let started = false;
  let ownedProcess: OwnedPipeProcess | undefined;
  let firstDrainFailure: CommandOutputInterruptionReason | undefined;
  let runtimeTransportLost = false;
  let drainDeadlineTimer: NodeJS.Timeout | undefined;

  function allStreamsSettled(): boolean {
    return stdout.settled && stderr.settled;
  }

  function markInterrupted(
    state: OutputStreamState,
    reason: CommandOutputInterruptionReason,
  ): void {
    state.interruptionReason ??= reason;
    firstDrainFailure ??= reason;
  }

  function settleStream(state: OutputStreamState): void {
    if (state.settled) return;
    state.settled = true;
    streamSettlements.get(state.channel)?.resolve();
    if (allStreamsSettled() && drainDeadlineTimer) clearTimeout(drainDeadlineTimer);
  }

  function destroyUnsettledStreams(reason: CommandOutputInterruptionReason): void {
    const process = ownedProcess;
    for (const [stream, state] of [
      [process?.stdout, stdout],
      [process?.stderr, stderr],
    ] as const) {
      if (state.settled) continue;
      markInterrupted(state, reason);
      stream?.destroy();
      settleStream(state);
    }
  }

  function requestTermination(cause: CommandOwnerTerminationCause): void {
    lifecycle.stop(cause);
  }

  function requestRuntimeFailureTermination(
    failureCode: 'runtime_lost' | 'internal_failure' = 'internal_failure',
  ): void {
    lifecycle.fail(failureCode);
  }

  function offerBytes(state: OutputStreamState, rawBytes: Uint8Array): void {
    state.observedBytes += rawBytes.byteLength;
    if (state.interruptionReason) return;

    for (let offset = 0; offset < rawBytes.byteLength; offset += MAX_COMMAND_OUTPUT_EVENT_BYTES) {
      const bytes = rawBytes.subarray(
        offset,
        Math.min(offset + MAX_COMMAND_OUTPUT_EVENT_BYTES, rawBytes.byteLength),
      );
      const event = parseCommandRunnerEvent({
        protocol_version: 1,
        kind: 'command_runner_output',
        identity,
        channel: state.channel,
        sequence: state.nextSequence,
        bytes,
      });
      if (event.kind !== 'command_runner_output') {
        throw new Error('command runner output projection produced a non-output event');
      }
      const offered = input.events.offerOutput(event);
      if (offered.status === 'accepted') {
        state.nextSequence += 1;
        continue;
      }
      if (offered.status === 'overloaded') {
        markInterrupted(state, 'runner_output_queue_overloaded');
        return;
      }

      runtimeTransportLost = true;
      markInterrupted(state, 'runtime_lost');
      requestRuntimeFailureTermination('runtime_lost');
      destroyUnsettledStreams('runtime_lost');
      return;
    }
  }

  function observeStream(stream: Readable, state: OutputStreamState): void {
    stream.on('data', (chunk: Buffer) => {
      offerBytes(state, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    });
    stream.once('end', () => settleStream(state));
    stream.once('error', () => {
      markInterrupted(state, 'stream_read_failed');
      settleStream(state);
      requestRuntimeFailureTermination();
    });
    stream.once('close', () => {
      if (!state.settled) {
        markInterrupted(state, 'stream_read_failed');
        settleStream(state);
        requestRuntimeFailureTermination();
      }
    });
    stream.resume();
  }

  async function sendTerminal(
    terminal: CommandExecutionTerminalV1,
    outputSources?: CommandRunnerPipeOutputSettlementV1,
  ): Promise<void> {
    const event = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal,
      ...(outputSources ? { output_sources: outputSources } : {}),
    });
    if (event.kind !== 'command_runner_terminal') {
      throw new Error('command runner terminal projection produced a non-terminal event');
    }
    await input.events.sendControl(event);
  }

  async function start(): Promise<void> {
    if (started) throw new Error('disposable command run can only start once');
    started = true;
    lifecycle.begin();
    try {
      ownedProcess = await input.launchOwnedProcess(
        request.launch,
        {
          abortSignal: lifecycle.abortSignal,
          ...(request.internal_environment
            ? { internalEnvironment: request.internal_environment }
            : {}),
        },
      );
    } catch (error) {
      const outcome = lifecycle.finishBeforeAttach();
      await sendTerminal(createNotStartedTerminal({
        request,
        settledAtMs: now(),
        stopCause: outcome?.outcome === 'execution_ended'
          && outcome.terminationCause !== 'natural_exit'
          ? outcome.terminationCause
          : undefined,
        launchError: error,
      }));
      return;
    }

    const process = ownedProcess;
    lifecycle.attach(process);
    const treeEmptyFact = lifecycle.treeSettlement();
    const ownerSettlement = lifecycle.settlement();
    const rootCloseFact = observeCommandPromise(
      process.rootClose,
      'command root close observation failed',
    );
    void rootCloseFact.then((fact) => {
      if (fact.status === 'failed') requestRuntimeFailureTermination();
    });

    const startedEvent = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_started',
      identity,
      started_at_ms: now(),
    });
    if (startedEvent.kind !== 'command_runner_started') {
      throw new Error('command runner started projection produced a non-started event');
    }
    try {
      await input.events.sendControl(startedEvent);
    } catch (error) {
      runtimeTransportLost = true;
      markInterrupted(stdout, 'runtime_lost');
      markInterrupted(stderr, 'runtime_lost');
      requestRuntimeFailureTermination('runtime_lost');
      destroyUnsettledStreams('runtime_lost');
      lifecycle.allowRelease();
      await ownerSettlement;
      throw error;
    }

    observeStream(process.stdout, stdout);
    observeStream(process.stderr, stderr);

    const treeFact = await treeEmptyFact;
    if (!allStreamsSettled()) {
      drainDeadlineTimer = setTimeout(() => {
        destroyUnsettledStreams('drain_deadline_exceeded');
      }, postTreeSettlementDeadlineMs);
    }
    const stdoutSettlement = streamSettlements.get('stdout');
    const stderrSettlement = streamSettlements.get('stderr');
    if (!stdoutSettlement || !stderrSettlement) {
      throw new Error('command runner output settlement is unavailable');
    }
    // tree cleanup 已经结算后，root exit callback 仍可能因平台观察失败永远不来。
    // 它和 pipe drain 共用有限收口窗口，避免一个丢失事件阻断 release 与最终终态。
    await Promise.all([
      stdoutSettlement.promise,
      stderrSettlement.promise,
    ]);
    lifecycle.allowRelease();
    const settlement = await ownerSettlement;
    if (drainDeadlineTimer) clearTimeout(drainDeadlineTimer);

    const outputSources: CommandRunnerPipeOutputSettlementV1 = {
      mode: 'pipe',
      stdout: toOutputSettlement(stdout),
      stderr: toOutputSettlement(stderr),
    };
    const processExit = settlement.rootExit.status === 'succeeded'
      ? {
          status: 'observed' as const,
          exit_code: settlement.rootExit.value.exitCode,
          signal: settlement.rootExit.value.signal,
        }
      : {
          status: 'unavailable' as const,
          reason: runtimeTransportLost ? 'runtime_lost' as const : 'platform_not_reported' as const,
        };
    const outputDrain = firstDrainFailure
      ? {
          status: 'failed' as const,
          code: 'output_drain_failed' as const,
          reason: firstDrainFailure,
        }
      : { status: 'complete' as const };
    const treeCleanup = treeFact.status === 'succeeded' && treeFact.value.status === 'succeeded'
      ? { status: 'succeeded' as const }
      : { status: 'failed' as const, code: 'tree_cleanup_failed' as const };
    const resourceRelease = settlement.resourceRelease.status === 'succeeded'
      && settlement.resourceRelease.value.status === 'succeeded'
      ? { status: 'succeeded' as const }
      : { status: 'failed' as const, code: 'resource_release_failed' as const };

    // 主终因采用先发生者，后续 drain/tree/release 失败只写入各自事实字段。
    // 否则用户取消会被迟到的 root callback 丢失改写，或运行时故障会被超时改写。
    const finalWinner = settlement.outcome;
    const terminal = finalWinner.outcome === 'runtime_failure'
      ? parseCommandExecutionTerminal({
          protocol_version: 1,
          kind: 'command_execution_terminal',
          identity,
          settled_at_ms: now(),
          outcome: 'runtime_failure',
          failure: { code: finalWinner.failureCode },
          process_exit: processExit,
          output_drain: outputDrain,
          tree_cleanup: treeCleanup,
          resource_release: resourceRelease,
        })
      : parseCommandExecutionTerminal({
          protocol_version: 1,
          kind: 'command_execution_terminal',
          identity,
          settled_at_ms: now(),
          outcome: 'execution_ended',
          termination_cause: finalWinner.terminationCause,
          process_exit: processExit,
          output_drain: outputDrain,
          tree_cleanup: treeCleanup,
          resource_release: resourceRelease,
        });
    await sendTerminal(terminal, outputSources);
  }

  return {
    start,
    stop: requestTermination,
  };
}
