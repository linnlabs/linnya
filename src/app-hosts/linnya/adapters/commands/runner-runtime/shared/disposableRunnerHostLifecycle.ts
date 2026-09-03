import {
  hasSameCommandExecutionIdentity,
  parseCommandRunnerEvent,
  parseCommandRunnerRequest,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
  type CommandRunnerEventV1,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';
import type {
  CommandExecutionPreparedRuntimeStartResult,
  CommandExecutionRuntimeStopCause,
  CommandRunnerProcessControl,
  CommandRunnerProcessPort,
} from '../../../../../../domains/commands';

type RunnerTerminalEvent = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_terminal' }
>;
type RunnerStartedEvent = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_started' }
>;
type RunnerModeEvent = Exclude<CommandRunnerEventV1, RunnerTerminalEvent | RunnerStartedEvent>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

export function requireRunnerDeadline(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

/**
 * 这是收到 started 后 Host 对一次性 Utility/IPC 的最后沉默期限，不是第二个用户命令超时。
 * hard timeout 到期只会要求 child owner 开始收树；它还需要用现有启动与关闭预算完成
 * 平台收树、输出排空和 release。这里复用这些既有预算，避免 Host 抢先覆盖真实终因。
 */
export function deriveRunnerPostStartInterventionDeadlineMs(input: {
  readonly startHandshakeDeadlineMs: number;
  readonly commandHardTimeoutMs: number;
  readonly closeDeadlineMs: number;
}): number {
  const values = [
    requireRunnerDeadline(input.commandHardTimeoutMs, 'command hard timeout'),
    requireRunnerDeadline(input.startHandshakeDeadlineMs, 'runner settlement grace'),
    requireRunnerDeadline(input.closeDeadlineMs, 'runner close deadline'),
  ];
  const total = values.reduce((sum, value) => sum + value, 0);
  return requireRunnerDeadline(total, 'runner post-start intervention deadline');
}

export function isRunnerWireStopCause(
  cause: CommandExecutionRuntimeStopCause,
): cause is CommandOwnerTerminationCause {
  return cause !== 'runtime_start_failed';
}

export interface DisposableRunnerHostSettlement<TSettlement> {
  settleBeforeSourceStart(input:
    | { readonly kind: 'failure'; readonly failureCode: 'runtime_unavailable' | 'internal_failure' }
    | { readonly kind: 'termination'; readonly cause: CommandOwnerTerminationCause }
  ): Promise<TSettlement>;
  settleRunnerTerminal(event: RunnerTerminalEvent, sealedAtMs: number): Promise<TSettlement>;
  settleRuntimeLoss(input: {
    readonly settledAtMs: number;
    readonly resourceRelease: 'succeeded' | 'failed';
    readonly candidate?: CommandExecutionTerminalV1;
  }): Promise<TSettlement>;
  terminalOf(settlement: TSettlement): CommandExecutionTerminalV1;
  runtimeLostFallback(input: {
    readonly settledAtMs: number;
    readonly resourceRelease: 'succeeded' | 'failed';
    readonly candidate?: CommandExecutionTerminalV1;
  }): CommandExecutionTerminalV1;
  onSettlementSucceeded?(settlement: TSettlement): void;
  onSettlementFailed?(error: unknown): void;
}

export interface DisposableRunnerHostLifecycle {
  readonly terminal: Promise<CommandExecutionTerminalV1>;
  readonly startResult: Promise<CommandExecutionPreparedRuntimeStartResult>;
  beginStart(): void;
  startRunner(): void;
  settlePrelaunchFailure(terminal: CommandExecutionTerminalV1): void;
  stop(cause: CommandExecutionRuntimeStopCause): Promise<CommandExecutionTerminalV1>;
  send(request: CommandRunnerRequestV1): Promise<void>;
  isInteractionOpen(): boolean;
  failProtocol(): void;
}

/**
 * 这里只拥有一次性 helper 的 transport 生命周期。输出封存由模式 settlement port
 * 完成；PTY interaction 的 pending identity 也留在 PTY feature，避免 shared 理解业务流。
 */
export function createDisposableRunnerHostLifecycle<TSettlement>(input: {
  readonly identity: CommandExecutionIdentity;
  readonly startRequest: Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>;
  readonly runnerProcess: CommandRunnerProcessPort;
  readonly startHandshakeDeadlineMs: number;
  readonly closeDeadlineMs: number;
  readonly postStartInterventionDeadlineMs: number;
  readonly now: () => number;
  readonly onDiagnostic?: (bytes: Uint8Array) => void;
  readonly acceptStarted: (event: RunnerStartedEvent) => boolean;
  readonly acceptModeEvent: (event: RunnerModeEvent) => boolean;
  readonly acceptTerminal: (event: RunnerTerminalEvent) => boolean;
  readonly settlement: DisposableRunnerHostSettlement<TSettlement>;
  readonly onInteractionClosing?: (reason: 'stdin_closed' | 'interaction_failed') => void;
}): DisposableRunnerHostLifecycle {
  const terminalDeferred = deferred<CommandExecutionTerminalV1>();
  const startDeferred = deferred<CommandExecutionPreparedRuntimeStartResult>();
  let startCalled = false;
  let startSettled = false;
  let terminalSettled = false;
  let runnerStarted = false;
  let startedAtMs: number | undefined;
  let runner: CommandRunnerProcessControl | undefined;
  let runnerClosed = false;
  let runnerFailed = false;
  let runnerTerminal: RunnerTerminalEvent | undefined;
  let startRequestDelivered = false;
  let stopRequestSent = false;
  let firstStopCause: CommandExecutionRuntimeStopCause | undefined;
  let startHandshakeTimer: NodeJS.Timeout | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  let hostFinalTimer: NodeJS.Timeout | undefined;
  let settlementPromise: Promise<TSettlement> | undefined;
  let diagnosticSinkAvailable = true;

  function clearTimers(): void {
    if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
    if (closeTimer) clearTimeout(closeTimer);
    if (hostFinalTimer) clearTimeout(hostFinalTimer);
    startHandshakeTimer = undefined;
    closeTimer = undefined;
    hostFinalTimer = undefined;
  }

  function settleTerminal(terminal: CommandExecutionTerminalV1): void {
    if (terminalSettled) return;
    terminalSettled = true;
    clearTimers();
    input.onInteractionClosing?.('stdin_closed');
    terminalDeferred.resolve(terminal);
    if (!startSettled) {
      startSettled = true;
      startDeferred.resolve({
        status: 'terminal',
        terminal,
        ...(startedAtMs === undefined ? {} : { startedAtMs }),
      });
    }
  }

  function settleWork(
    work: Promise<TSettlement>,
    fallbackResourceRelease: 'succeeded' | 'failed',
  ): void {
    if (settlementPromise || terminalSettled) return;
    settlementPromise = work;
    void work.then(
      (settlement) => {
        input.settlement.onSettlementSucceeded?.(settlement);
        settleTerminal(input.settlement.terminalOf(settlement));
      },
      (error: unknown) => {
        input.settlement.onSettlementFailed?.(error);
        settleTerminal(input.settlement.runtimeLostFallback({
          settledAtMs: input.now(),
          resourceRelease: fallbackResourceRelease,
          candidate: runnerTerminal?.terminal,
        }));
      },
    );
  }

  function settleRuntimeLoss(resourceRelease: 'succeeded' | 'failed'): void {
    if (settlementPromise || terminalSettled) return;
    settleWork(input.settlement.settleRuntimeLoss({
      settledAtMs: input.now(),
      resourceRelease,
      candidate: runnerTerminal?.terminal,
    }), resourceRelease);
  }

  function startCloseDeadline(options: {
    readonly terminateOnExpiry?: boolean;
  } = {}): void {
    if (runnerClosed || closeTimer || terminalSettled) return;
    closeTimer = setTimeout(() => {
      if (options.terminateOnExpiry !== false) {
        runner?.disconnect();
        runner?.kill();
      }
      settleRuntimeLoss('failed');
    }, input.closeDeadlineMs);
  }

  function startPostStartInterventionDeadline(): void {
    if (hostFinalTimer || terminalSettled || runnerClosed) return;
    hostFinalTimer = setTimeout(() => {
      hostFinalTimer = undefined;
      runnerFailed = true;
      input.onInteractionClosing?.('interaction_failed');
      if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
      if (closeTimer) clearTimeout(closeTimer);
      startHandshakeTimer = undefined;
      closeTimer = undefined;
      runner?.disconnect();
      runner?.kill();
      // kill() 后的 close 通常异步到达。沿用既有关闭预算等待真实 close；只有预算
      // 也耗尽时才冻结资源失败，不能用“已经调用 kill”冒充已经释放。
      if (runnerClosed) settleRuntimeLoss('succeeded');
      else startCloseDeadline({ terminateOnExpiry: false });
    }, input.postStartInterventionDeadlineMs);
  }

  function failProtocol(): void {
    if (runnerFailed || terminalSettled) return;
    runnerFailed = true;
    input.onInteractionClosing?.('interaction_failed');
    if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
    runner?.disconnect();
    if (runnerClosed) settleRuntimeLoss('succeeded');
    else startCloseDeadline();
  }

  function acceptDiagnostic(bytes: Uint8Array): void {
    if (!diagnosticSinkAvailable || !input.onDiagnostic) return;
    try {
      input.onDiagnostic(bytes);
    } catch {
      // 诊断是旁路观察；首次 sink 失败后熔断，不能改变命令终因。
      diagnosticSinkAvailable = false;
    }
  }

  function acceptMessage(rawEvent: unknown): void {
    if (runnerFailed || terminalSettled) return;
    try {
      if (runnerTerminal) {
        failProtocol();
        return;
      }
      const event = parseCommandRunnerEvent(rawEvent);
      const identity = event.kind === 'command_runner_terminal'
        ? event.terminal.identity
        : event.identity;
      if (!hasSameCommandExecutionIdentity(input.identity, identity)) {
        failProtocol();
        return;
      }
      if (event.kind === 'command_runner_started') {
        if (runnerStarted || !input.acceptStarted(event)) {
          failProtocol();
          return;
        }
        runnerStarted = true;
        startedAtMs = event.started_at_ms;
        if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
        startHandshakeTimer = undefined;
        startPostStartInterventionDeadline();
        if (!startSettled) {
          startSettled = true;
          startDeferred.resolve({ status: 'running', startedAtMs });
        }
        return;
      }
      if (event.kind === 'command_runner_terminal') {
        if (!input.acceptTerminal(event)) {
          failProtocol();
          return;
        }
        if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
        if (hostFinalTimer) clearTimeout(hostFinalTimer);
        startHandshakeTimer = undefined;
        hostFinalTimer = undefined;
        runnerTerminal = event;
        input.onInteractionClosing?.('stdin_closed');
        startCloseDeadline();
        return;
      }
      if (!runnerStarted) {
        failProtocol();
        return;
      }
      if (!input.acceptModeEvent(event)) failProtocol();
    } catch {
      failProtocol();
    }
  }

  function acceptClose(): void {
    if (runnerClosed) return;
    runnerClosed = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (startHandshakeTimer) clearTimeout(startHandshakeTimer);
    if (hostFinalTimer) clearTimeout(hostFinalTimer);
    hostFinalTimer = undefined;
    input.onInteractionClosing?.(runnerTerminal ? 'stdin_closed' : 'interaction_failed');
    if (terminalSettled) return;
    if (runnerFailed || !runnerTerminal) {
      settleRuntimeLoss('succeeded');
      return;
    }
    settleWork(
      input.settlement.settleRunnerTerminal(runnerTerminal, input.now()),
      'succeeded',
    );
  }

  function createStopRequest(cause: CommandOwnerTerminationCause): CommandRunnerRequestV1 {
    return parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_stop',
      identity: input.identity,
      cause,
    });
  }

  function sendPendingStop(): void {
    if (
      stopRequestSent
      || !startRequestDelivered
      || !firstStopCause
      || !runner
      || runnerFailed
      || runnerTerminal
      || terminalSettled
    ) return;
    if (!isRunnerWireStopCause(firstStopCause)) {
      failProtocol();
      return;
    }
    stopRequestSent = true;
    void runner.send(createStopRequest(firstStopCause)).catch(() => failProtocol());
  }

  function beginStart(): void {
    if (startCalled) throw new Error('prepared command runtime can only start once');
    startCalled = true;
  }

  function startRunner(): void {
    if (!startCalled) throw new Error('prepared command runtime must begin before runner start');
    if (settlementPromise || terminalSettled) return;
    if (firstStopCause) {
      settleWork(input.settlement.settleBeforeSourceStart(
        isRunnerWireStopCause(firstStopCause)
          ? { kind: 'termination', cause: firstStopCause }
          : { kind: 'failure', failureCode: 'internal_failure' },
      ), 'succeeded');
      return;
    }
    try {
      runner = input.runnerProcess.fork({
        onMessage: acceptMessage,
        onDiagnostic: acceptDiagnostic,
        onDisconnect: () => { if (!runnerTerminal) failProtocol(); },
        onError: () => failProtocol(),
        onClose: acceptClose,
      });
    } catch {
      settleWork(input.settlement.settleBeforeSourceStart({
        kind: 'failure',
        failureCode: 'runtime_unavailable',
      }), 'succeeded');
      return;
    }
    startHandshakeTimer = setTimeout(() => failProtocol(), input.startHandshakeDeadlineMs);
    void runner.send(input.startRequest).then(
      () => {
        startRequestDelivered = true;
        sendPendingStop();
      },
      () => failProtocol(),
    );
  }

  function settlePrelaunchFailure(terminal: CommandExecutionTerminalV1): void {
    settleTerminal(terminal);
  }

  function stop(cause: CommandExecutionRuntimeStopCause): Promise<CommandExecutionTerminalV1> {
    firstStopCause ??= cause;
    input.onInteractionClosing?.('stdin_closed');
    sendPendingStop();
    return terminalDeferred.promise;
  }

  function send(request: CommandRunnerRequestV1): Promise<void> {
    if (!runner || !runnerStarted || runnerFailed || runnerTerminal || terminalSettled) {
      return Promise.reject(new Error('command runner interaction channel is closed'));
    }
    return runner.send(request);
  }

  return Object.freeze({
    terminal: terminalDeferred.promise,
    startResult: startDeferred.promise,
    beginStart,
    startRunner,
    settlePrelaunchFailure,
    stop,
    send,
    isInteractionOpen: () => Boolean(
      runner && runnerStarted && !runnerFailed && !runnerTerminal && !terminalSettled,
    ),
    failProtocol,
  });
}
