import type { Readable } from 'node:stream';

import {
  CommandOutputSequenceSchema,
  MAX_COMMAND_OUTPUT_EVENT_BYTES,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionTerminalV1,
  type CommandOutputInterruptionReason,
  type CommandOwnerTerminationCause,
  type CommandRunnerInteractionId,
  type CommandRunnerPtyOutputSettlementV1,
  type CommandRunnerRequestV1,
  type ProcessInteractionActionV1,
  type ProcessInteractionRejectionCode,
  type PtyCommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import {
  CommandRunnerOwnedPtyProcessLaunchError,
  type LaunchCommandRunnerOwnedPtyProcess,
} from '../definitions/commandRunnerOwnedPtyProcess';
import type { CommandRunnerEventTransport } from '../definitions/commandRunnerOutputTransport';
import type { OwnedPtyCommandProcess } from '../definitions/ownedPtyCommandProcess';
import {
  createNotStartedCommandTerminal,
  createOwnedCommandLifecycle,
} from '../shared/ownedCommandLifecycle';

const PTY_INPUT_ENCODER = new TextEncoder();

/**
 * 这是一次 PTY execution 的累计输入上限，不是单次 action 上限。单次 64 KiB 由
 * schema 负责；runner 在真正调用无 drain 回执的 backend 前负责生命周期总预算。
 */
export const MAX_DISPOSABLE_PTY_INPUT_BYTES = 4 * 1024 * 1024;

type CommandRunnerStartRequestV1 = Extract<
  CommandRunnerRequestV1,
  { readonly kind: 'command_runner_start' }
>;

type PtyCommandRunnerStartRequestV1 = Omit<CommandRunnerStartRequestV1, 'launch'> & {
  readonly launch: PtyCommandLaunchSnapshotV1;
};

function isPtyCommandRunnerStartRequest(
  request: CommandRunnerStartRequestV1,
): request is PtyCommandRunnerStartRequestV1 {
  return request.launch.mode === 'pty';
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

interface PtyOutputState {
  nextSequence: number;
  observedBytes: number;
  settled: boolean;
  interruptionReason?: CommandOutputInterruptionReason;
}

export interface DisposablePtyCommandRun {
  start(): Promise<void>;
  stop(cause: CommandOwnerTerminationCause): void;
  interact(
    interactionId: CommandRunnerInteractionId,
    action: ProcessInteractionActionV1,
  ): Promise<void>;
}

function deferred(): Deferred {
  let settled = false;
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}

function toOutputSettlement(
  state: PtyOutputState,
): CommandRunnerPtyOutputSettlementV1['terminal'] {
  const base = {
    next_sequence: CommandOutputSequenceSchema.parse(state.nextSequence),
    observed_bytes: state.observedBytes,
  };
  return state.interruptionReason
    ? {
        ...base,
        source_completion: 'interrupted' as const,
        interruption_reason: state.interruptionReason,
      }
    : { ...base, source_completion: 'complete' as const };
}

function createNotStartedTerminal(input: {
  readonly request: PtyCommandRunnerStartRequestV1;
  readonly settledAtMs: number;
  readonly stopCause?: CommandOwnerTerminationCause;
  readonly launchError?: unknown;
}): CommandExecutionTerminalV1 {
  const launchError = input.launchError instanceof CommandRunnerOwnedPtyProcessLaunchError
    ? input.launchError
    : undefined;
  const cleanup = launchError?.settlement.status === 'startup_cleanup_observed'
    ? launchError.settlement
    : undefined;
  return createNotStartedCommandTerminal({
    identity: input.request.launch.proposal.identity,
    settledAtMs: input.settledAtMs,
    stopCause: input.stopCause,
    failureCode: launchError?.failureCode ?? 'launch_failed',
    cleanup,
  });
}

function inputByteLength(action: ProcessInteractionActionV1): number {
  return action.type === 'write' || action.type === 'submit'
    ? PTY_INPUT_ENCODER.encode(action.input).byteLength
    : 0;
}

/**
 * 编排一次显式 PTY execution。平台 owner 仍独占进程树和 backend 事实；本模块只把
 * terminal transcript、交互结果和 owner settlement 投影到既有 runner wire。
 */
export function createDisposablePtyCommandRun(input: {
  readonly request: CommandRunnerStartRequestV1;
  readonly events: CommandRunnerEventTransport;
  readonly launchOwnedProcess: LaunchCommandRunnerOwnedPtyProcess;
  readonly now?: () => number;
  readonly postTreeSettlementDeadlineMs?: number;
  readonly maxInputBytes?: number;
}): DisposablePtyCommandRun {
  if (!isPtyCommandRunnerStartRequest(input.request)) {
    throw new Error('disposable PTY command run requires a PTY start request');
  }
  const request = input.request;
  const identity = request.launch.proposal.identity;
  const now = input.now ?? Date.now;
  const postTreeSettlementDeadlineMs = input.postTreeSettlementDeadlineMs ?? 2_000;
  const maxInputBytes = input.maxInputBytes ?? MAX_DISPOSABLE_PTY_INPUT_BYTES;
  const terminalState: PtyOutputState = {
    nextSequence: 0,
    observedBytes: 0,
    settled: false,
  };
  const terminalSettlement = deferred();
  const lifecycle = createOwnedCommandLifecycle({
    hardTimeoutMs: request.launch.hard_timeout_ms,
    postTreeSettlementDeadlineMs,
    releasePolicy: 'after_tree',
  });
  let started = false;
  let acceptingInteractions = false;
  let interactionResultsClosed = false;
  let ownedProcess: OwnedPtyCommandProcess | undefined;
  let runtimeTransportLost = false;
  let inputBytesHandedToBackend = 0;
  let drainDeadlineTimer: NodeJS.Timeout | undefined;
  let interactionChain = Promise.resolve();

  function markTerminalInterrupted(reason: CommandOutputInterruptionReason): void {
    terminalState.interruptionReason ??= reason;
  }

  function settleTerminal(): void {
    if (terminalState.settled) return;
    terminalState.settled = true;
    if (drainDeadlineTimer) clearTimeout(drainDeadlineTimer);
    terminalSettlement.resolve();
  }

  function destroyTerminal(reason: CommandOutputInterruptionReason): void {
    if (terminalState.settled) return;
    markTerminalInterrupted(reason);
    ownedProcess?.terminal.destroy();
    settleTerminal();
  }

  function requestTermination(cause: CommandOwnerTerminationCause): void {
    acceptingInteractions = false;
    lifecycle.stop(cause);
  }

  function requestRuntimeFailureTermination(
    failureCode: 'runtime_lost' | 'internal_failure' = 'internal_failure',
  ): void {
    acceptingInteractions = false;
    lifecycle.fail(failureCode);
  }

  function offerTerminalBytes(rawBytes: Uint8Array): void {
    terminalState.observedBytes += rawBytes.byteLength;
    if (terminalState.interruptionReason) return;
    for (let offset = 0; offset < rawBytes.byteLength; offset += MAX_COMMAND_OUTPUT_EVENT_BYTES) {
      const bytes = rawBytes.subarray(
        offset,
        Math.min(offset + MAX_COMMAND_OUTPUT_EVENT_BYTES, rawBytes.byteLength),
      );
      const event = parseCommandRunnerEvent({
        protocol_version: 1,
        kind: 'command_runner_pty_output',
        identity,
        channel: 'terminal',
        sequence: terminalState.nextSequence,
        bytes,
      });
      if (event.kind !== 'command_runner_pty_output') {
        throw new Error('command runner PTY output projection produced a non-PTY event');
      }
      const offered = input.events.offerOutput(event);
      if (offered.status === 'accepted') {
        terminalState.nextSequence += 1;
        continue;
      }
      if (offered.status === 'overloaded') {
        markTerminalInterrupted('runner_output_queue_overloaded');
        return;
      }
      runtimeTransportLost = true;
      markTerminalInterrupted('runtime_lost');
      requestRuntimeFailureTermination('runtime_lost');
      destroyTerminal('runtime_lost');
      return;
    }
  }

  function observeTerminal(stream: Readable): void {
    stream.on('data', (chunk: Buffer) => {
      offerTerminalBytes(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    });
    stream.once('end', settleTerminal);
    stream.once('error', () => {
      markTerminalInterrupted('stream_read_failed');
      settleTerminal();
      requestRuntimeFailureTermination();
    });
    stream.once('close', () => {
      if (terminalState.settled) return;
      markTerminalInterrupted('stream_read_failed');
      settleTerminal();
      requestRuntimeFailureTermination();
    });
    stream.resume();
  }

  async function sendInteractionResult(
    interactionId: CommandRunnerInteractionId,
    result: { readonly status: 'accepted' } | {
      readonly status: 'rejected';
      readonly code: ProcessInteractionRejectionCode;
    },
  ): Promise<void> {
    const event = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_interaction_result',
      identity,
      interaction_id: interactionId,
      result,
    });
    if (event.kind !== 'command_runner_interaction_result') {
      throw new Error('command interaction projection produced a non-interaction event');
    }
    await input.events.sendControl(event);
  }

  function interact(
    interactionId: CommandRunnerInteractionId,
    action: ProcessInteractionActionV1,
  ): Promise<void> {
    // tree 已经结算后，terminal 会作为 host 侧 pending interaction 的统一关闭事实。
    // 此时再发送单独 result 可能越过 terminal；因此不再启动新的 control 发布。
    if (interactionResultsClosed) return Promise.resolve();
    const operation = interactionChain.then(async () => {
      const process = ownedProcess;
      if (!acceptingInteractions || !process) {
        await sendInteractionResult(interactionId, {
          status: 'rejected',
          code: 'stdin_closed',
        });
        return;
      }

      const actionBytes = inputByteLength(action);
      if (inputBytesHandedToBackend + actionBytes > maxInputBytes) {
        await sendInteractionResult(interactionId, {
          status: 'rejected',
          code: 'input_budget_exceeded',
        });
        return;
      }

      // backend 没有“撤回”或 drain 回执。进入调用边界后，即使 Promise 随后拒绝，
      // 也不能证明平台未消费部分输入，因此这些 byte 必须计入生命周期预算。
      inputBytesHandedToBackend += actionBytes;
      let result: { readonly status: 'accepted' } | {
        readonly status: 'rejected';
        readonly code: ProcessInteractionRejectionCode;
      };
      try {
        await process.interact(action);
        result = { status: 'accepted' };
      } catch {
        result = {
          status: 'rejected',
          code: 'interaction_failed',
        };
      }
      // transport 失败不能被误判成 backend 拒绝并为同一 identity 再发送第二次结果。
      await sendInteractionResult(interactionId, result);
    });
    interactionChain = operation.catch(() => {
      runtimeTransportLost = true;
      requestRuntimeFailureTermination('runtime_lost');
    });
    return operation;
  }

  async function sendTerminal(
    terminal: CommandExecutionTerminalV1,
    outputSources?: CommandRunnerPtyOutputSettlementV1,
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
    if (started) throw new Error('disposable PTY command run can only start once');
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
    const treeSettlement = lifecycle.treeSettlement();
    const ownerSettlement = lifecycle.settlement();
    void process.backendFailure.then(
      () => requestRuntimeFailureTermination(),
      () => requestRuntimeFailureTermination(),
    );

    const startedEvent = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_started',
      identity,
      started_at_ms: now(),
    });
    if (startedEvent.kind !== 'command_runner_started') {
      throw new Error('command runner started projection produced a non-started event');
    }
    // host 只有收到 started 后才可能发来 interaction。准入必须在发送前建立，避免
    // started 已到 host、send Promise 尚未回到本地时把首个合法输入误报为 stdin_closed。
    acceptingInteractions = lifecycle.currentOutcome() === undefined;
    try {
      await input.events.sendControl(startedEvent);
    } catch (error) {
      acceptingInteractions = false;
      runtimeTransportLost = true;
      markTerminalInterrupted('runtime_lost');
      requestRuntimeFailureTermination('runtime_lost');
      destroyTerminal('runtime_lost');
      await ownerSettlement;
      throw error;
    }

    observeTerminal(process.terminal);

    void treeSettlement.then(() => {
      acceptingInteractions = false;
      interactionResultsClosed = true;
      if (!terminalState.settled) {
        drainDeadlineTimer = setTimeout(
          () => destroyTerminal('drain_deadline_exceeded'),
          postTreeSettlementDeadlineMs,
        );
      }
    });
    const [settlement] = await Promise.all([
      ownerSettlement,
      terminalSettlement.promise,
      // terminal 必须位于所有已接收 interaction result 之后；关闭准入后再等待串行链，
      // 也保证排队但尚未交给 backend 的动作稳定返回 stdin_closed。
      treeSettlement.then(() => interactionChain),
    ]);
    if (drainDeadlineTimer) clearTimeout(drainDeadlineTimer);

    const outputSources: CommandRunnerPtyOutputSettlementV1 = {
      mode: 'pty',
      terminal: toOutputSettlement(terminalState),
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
    const outputDrain = terminalState.interruptionReason
      ? {
          status: 'failed' as const,
          code: 'output_drain_failed' as const,
          reason: terminalState.interruptionReason,
        }
      : { status: 'complete' as const };
    const treeCleanup = settlement.treeCleanup.status === 'succeeded'
      && settlement.treeCleanup.value.status === 'succeeded'
      ? { status: 'succeeded' as const }
      : { status: 'failed' as const, code: 'tree_cleanup_failed' as const };
    const resourceRelease = settlement.resourceRelease.status === 'succeeded'
      && settlement.resourceRelease.value.status === 'succeeded'
      ? { status: 'succeeded' as const }
      : { status: 'failed' as const, code: 'resource_release_failed' as const };
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

  return Object.freeze({ start, stop: requestTermination, interact });
}
