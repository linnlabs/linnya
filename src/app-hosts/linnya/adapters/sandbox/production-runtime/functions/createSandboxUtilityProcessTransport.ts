import {
  SANDBOX_UTILITY_ACK_DEADLINE_MS,
  parseSandboxUtilityChildPayload,
  parseSandboxUtilityHostPayload,
  type SandboxUtilityChildPayload,
  type SandboxUtilityHostPayload,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';
import {
  createAcknowledgedSandboxUtilityTransport,
  type AcknowledgedSandboxUtilityTransport,
} from 'src/features/sandbox/runners/local-process/functions/createAcknowledgedSandboxUtilityTransport';
import type {
  CreateSandboxUtilityProcessTransportInput,
  SandboxUtilityEvaluatorFramePayload,
  SandboxUtilityProcessExit,
  SandboxUtilityProcessTerminal,
  SandboxUtilityProcessTransport,
  SandboxUtilityStartPayload,
  SandboxUtilityTerminalPayload,
} from '../definitions/sandboxUtilityProcessTransport';

const UTILITY_STDERR_TAIL_MAX_BYTES = 64 * 1024;
const UTILITY_EXIT_DEADLINE_MS = 2_000;
const EVALUATOR_FRAME_ORDER = ['ready', 'started', 'result_committed'] as const;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

interface PendingHostIntent<T> {
  readonly payload: T;
  readonly settlement: Deferred<void>;
  state: 'pending' | 'sending' | 'settled';
}

/**
 * Sandbox Utility 的 ACK 只证明消息被同步校验和接纳。这里另外维护 ready、Evaluator
 * frame 与 terminal 顺序，避免上层把一条 ACK 误当成 Sandbox 已经完成。
 */
export function createSandboxUtilityProcessTransport(
  input: CreateSandboxUtilityProcessTransportInput,
): SandboxUtilityProcessTransport {
  const ready = deferred<number>();
  const terminal = deferred<SandboxUtilityProcessTerminal>();
  const exit = deferred<SandboxUtilityProcessExit>();
  void ready.promise.catch(() => undefined);
  void terminal.promise.catch(() => undefined);
  const readyDeadlineMs = requirePositiveSafeInteger(
    input.readyDeadlineMs ?? SANDBOX_UTILITY_ACK_DEADLINE_MS,
    'sandbox utility ready deadline',
  );
  const exitDeadlineMs = requirePositiveSafeInteger(
    input.exitDeadlineMs ?? UTILITY_EXIT_DEADLINE_MS,
    'sandbox utility exit deadline',
  );
  const evaluatorFrames: SandboxUtilityEvaluatorFramePayload[] = [];
  let evaluatorPid: number | undefined;
  let utilityPid: number | undefined;
  let readyAccepted = false;
  let terminalAccepted = false;
  let startIntent: PendingHostIntent<SandboxUtilityStartPayload> | undefined;
  let cancelIntent: PendingHostIntent<Extract<
    SandboxUtilityHostPayload,
    { readonly kind: 'sandbox_cancel' }
  >> | undefined;
  let ownerEndIntent: PendingHostIntent<{ readonly kind: 'sandbox_owner_end' }> | undefined;
  let dispatchScheduled = false;
  let dispatching = false;
  let runToken: string | undefined;
  let ownerEndRequested = false;
  let closed = false;
  let closedReason: Error | undefined;
  let fatalErrorPublished = false;
  let transportFailure: Error | undefined;
  let gracefulExitSettlement: Promise<SandboxUtilityProcessExit> | undefined;
  let killExitSettlement: Promise<SandboxUtilityProcessExit> | undefined;
  let stderrAvailable = input.child.stderr !== null;
  let stderrBytes = 0;
  let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let transport: AcknowledgedSandboxUtilityTransport<SandboxUtilityHostPayload>;

  const readyTimer = setTimeout(() => {
    failAndTerminate(new Error('sandbox utility process did not publish ready before deadline'));
  }, readyDeadlineMs);

  function clearReadyDeadline(): void {
    clearTimeout(readyTimer);
  }

  function publishFatalError(error: Error): void {
    if (fatalErrorPublished) return;
    fatalErrorPublished = true;
    transportFailure = error;
    clearReadyDeadline();
    ready.reject(error);
    terminal.reject(error);
    rejectUnsettledHostIntents(error);
  }

  function failAndTerminate(error: Error): void {
    if (closed) return;
    publishFatalError(error);
    void beginKillExitSupervision().catch(() => undefined);
  }

  function rejectUnsettledHostIntents(error: Error): void {
    rejectIntent(startIntent, error);
    rejectIntent(cancelIntent, error);
    rejectIntent(ownerEndIntent, error);
  }

  function scheduleHostIntentDispatch(): void {
    if (!readyAccepted || closed || dispatchScheduled || dispatching) return;
    dispatchScheduled = true;
    queueMicrotask(() => {
      dispatchScheduled = false;
      void dispatchHostIntents();
    });
  }

  async function dispatchHostIntents(): Promise<void> {
    if (dispatching || closed || !readyAccepted) return;
    dispatching = true;
    try {
      while (!closed) {
        if (ownerEndIntent?.state === 'pending') {
          ownerEndIntent.state = 'sending';
          await transport.send(ownerEndIntent.payload);
          void beginGracefulExitSupervision();
          ownerEndIntent.state = 'settled';
          ownerEndIntent.settlement.resolve();
          const ownerError = new Error('sandbox utility owner has ended');
          rejectIntent(startIntent, ownerError);
          rejectIntent(cancelIntent, ownerError);
          return;
        }

        if (cancelIntent?.state === 'pending') {
          cancelIntent.state = 'sending';
          await transport.send(cancelIntent.payload);
          cancelIntent.state = 'settled';
          cancelIntent.settlement.resolve();
          continue;
        }

        if (startIntent?.state === 'pending') {
          // cancel ACK 等待期间可能到达 owner end；真正发送 start 前必须再次判断。
          if (ownerEndRequested) continue;
          startIntent.state = 'sending';
          await transport.send(startIntent.payload);
          startIntent.state = 'settled';
          startIntent.settlement.resolve();
          continue;
        }
        return;
      }
    } catch (error) {
      const failure = toError(error);
      rejectUnsettledHostIntents(failure);
      failAndTerminate(failure);
    } finally {
      dispatching = false;
      if (hasPendingHostIntent()) scheduleHostIntentDispatch();
    }
  }

  function hasPendingHostIntent(): boolean {
    return ownerEndIntent?.state === 'pending'
      || cancelIntent?.state === 'pending'
      || startIntent?.state === 'pending';
  }

  function acceptChildPayload(payload: SandboxUtilityChildPayload): undefined {
    if (payload.kind === 'sandbox_utility_ready') {
      if (readyAccepted) throw new Error('sandbox utility process published ready more than once');
      if (terminalAccepted || evaluatorFrames.length > 0) {
        throw new Error('sandbox utility process published ready after run events');
      }
      readyAccepted = true;
      utilityPid = payload.utilityPid;
      clearReadyDeadline();
      ready.resolve(payload.utilityPid);
      scheduleHostIntentDispatch();
      return undefined;
    }

    if (!readyAccepted) {
      throw new Error('sandbox utility process published an event before ready');
    }
    if (terminalAccepted) {
      throw new Error('sandbox utility process published an event after terminal');
    }
    if (!startIntent || startIntent.state === 'pending' || !runToken) {
      throw new Error('sandbox utility process published a run event before start');
    }
    if (payload.runToken !== runToken) {
      throw new Error('sandbox utility process payload token does not match active run');
    }

    if (payload.kind === 'sandbox_evaluator_frame') {
      const expectedFrame = EVALUATOR_FRAME_ORDER[evaluatorFrames.length];
      if (payload.frame !== expectedFrame) {
        throw new Error(
          `sandbox utility evaluator frame sequence mismatch: expected ${expectedFrame ?? 'terminal'}, received ${payload.frame}`,
        );
      }
      if (evaluatorPid !== undefined && payload.evaluatorPid !== evaluatorPid) {
        throw new Error('sandbox utility evaluator pid changed during one run');
      }
      evaluatorPid = payload.evaluatorPid;
      evaluatorFrames.push(payload);
      return undefined;
    }

    assertTerminalMatchesObservedFrames(payload, evaluatorFrames, evaluatorPid);
    if (utilityPid === undefined) {
      throw new Error('sandbox utility terminal was accepted without utility identity');
    }
    terminalAccepted = true;
    terminal.resolve({
      utilityPid,
      evaluatorFrames: Object.freeze([...evaluatorFrames]),
      terminal: payload,
    });
    void beginGracefulExitSupervision();
    return undefined;
  }

  transport = createAcknowledgedSandboxUtilityTransport({
    generation: input.generation,
    postMessage: envelope => input.child.postMessage(envelope),
    parseIncomingPayload: parseSandboxUtilityChildPayload,
    acceptIncomingPayload: acceptChildPayload,
    onFailure: failAndTerminate,
    acknowledgementDeadlineMs: input.acknowledgementDeadlineMs,
  });

  input.child.onMessage(message => transport.receive(message));
  input.child.onceError(failAndTerminate);
  input.child.onceExit((exitCode) => {
    if (closed) return;
    const exitError = new Error(`sandbox utility process exited: ${exitCode}`);
    const expectedExit = exitCode === 0
      && (terminalAccepted || ownerEndIntent?.state === 'settled')
      && transportFailure === undefined;
    if (!expectedExit) publishFatalError(exitError);
    if (!terminalAccepted) terminal.reject(exitError);
    rejectUnsettledHostIntents(exitError);
    closed = true;
    closedReason = exitError;
    clearReadyDeadline();
    transport.close(exitError);
    ready.reject(exitError);
    exit.resolve({
      exitCode,
      stderrBytes,
      stderrTail: stderrTail.toString('utf8'),
      ...(transportFailure ? { transportFailure } : {}),
    });
  });

  input.child.stderr?.on('data', (chunk: Buffer) => {
    if (!stderrAvailable) return;
    const bytes = Buffer.from(chunk);
    stderrBytes += bytes.byteLength;
    stderrTail = appendBoundedTail(stderrTail, bytes);
  });
  input.child.stderr?.once('error', () => {
    stderrAvailable = false;
  });
  input.child.stderr?.resume();

  return Object.freeze({
    waitUntilReady(): Promise<number> {
      return ready.promise;
    },

    async sendStart(payload: SandboxUtilityStartPayload): Promise<void> {
      const parsed = parseSandboxUtilityHostPayload(payload);
      if (parsed.kind !== 'sandbox_start') {
        throw new Error('sandbox utility start payload kind is invalid');
      }
      requireAvailable(closedReason, transportFailure);
      if (ownerEndRequested) throw new Error('sandbox utility owner has ended');
      if (startIntent) throw new Error('sandbox utility process accepts only one start');
      if (cancelIntent && cancelIntent.payload.runToken !== parsed.runToken) {
        throw new Error('sandbox utility pending cancellation token does not match start');
      }
      runToken = parsed.runToken;
      startIntent = createHostIntent(parsed);
      scheduleHostIntentDispatch();
      return startIntent.settlement.promise;
    },

    async sendCancel(candidateRunToken: string): Promise<void> {
      const parsed = parseSandboxUtilityHostPayload({
        kind: 'sandbox_cancel',
        runToken: candidateRunToken,
      });
      if (parsed.kind !== 'sandbox_cancel') {
        throw new Error('sandbox utility cancel payload kind is invalid');
      }
      requireAvailable(closedReason, transportFailure);
      if (ownerEndRequested) throw new Error('sandbox utility owner has ended');
      if ((runToken && parsed.runToken !== runToken)
        || (cancelIntent && parsed.runToken !== cancelIntent.payload.runToken)) {
        throw new Error('sandbox utility cancellation token does not match active run');
      }
      if (!cancelIntent) cancelIntent = createHostIntent(parsed);
      scheduleHostIntentDispatch();
      return cancelIntent.settlement.promise;
    },

    endOwner(): Promise<void> {
      if (ownerEndIntent) return ownerEndIntent.settlement.promise;
      if (closed || terminalAccepted) return Promise.resolve();
      if (transportFailure) return Promise.reject(transportFailure);
      ownerEndRequested = true;
      ownerEndIntent = createHostIntent({ kind: 'sandbox_owner_end' });
      scheduleHostIntentDispatch();
      return ownerEndIntent.settlement.promise;
    },

    waitForTerminal(): Promise<SandboxUtilityProcessTerminal> {
      return terminal.promise;
    },

    waitForExit(): Promise<SandboxUtilityProcessExit> {
      if (closed) return exit.promise;
      if (gracefulExitSettlement) return gracefulExitSettlement;
      if (transportFailure) return beginKillExitSupervision();
      if (ownerEndIntent) {
        return ownerEndIntent.settlement.promise.then(() => beginGracefulExitSupervision());
      }
      if (startIntent) {
        return terminal.promise.then(() => beginGracefulExitSupervision());
      }
      return Promise.reject(new Error(
        'sandbox utility exit wait requires terminal, owner end, or transport failure',
      ));
    },

    killAndWait(): Promise<SandboxUtilityProcessExit> {
      return beginKillExitSupervision();
    },
  });

  function beginGracefulExitSupervision(): Promise<SandboxUtilityProcessExit> {
    if (closed) return exit.promise;
    if (gracefulExitSettlement) return gracefulExitSettlement;
    gracefulExitSettlement = waitForObservedExit(
      exit.promise,
      exitDeadlineMs,
      'sandbox utility process did not exit after terminal or owner end',
    ).catch(error => {
      // terminal/owner ACK 后仍需强杀不是自然成功；先冻结失败，再开始 kill 观察。
      // 即使随后得到 exit 0，projector 也必须看到 Utility 未按协议自行退出。
      publishFatalError(toError(error));
      return beginKillExitSupervision();
    });
    void gracefulExitSettlement.catch(() => undefined);
    return gracefulExitSettlement;
  }

  function beginKillExitSupervision(): Promise<SandboxUtilityProcessExit> {
    if (closed) return exit.promise;
    if (killExitSettlement) return killExitSettlement;
    if (!input.child.kill()) {
      publishFatalError(new Error('sandbox utility process kill was rejected'));
    }
    const attempt = waitForObservedExit(
      exit.promise,
      exitDeadlineMs,
      'sandbox utility process did not exit after kill',
    ).catch(error => {
      const failure = toError(error);
      publishFatalError(failure);
      throw failure;
    });
    killExitSettlement = attempt;
    void attempt.finally(() => {
      if (killExitSettlement === attempt) killExitSettlement = undefined;
    }).catch(() => undefined);
    return attempt;
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createHostIntent<T>(payload: T): PendingHostIntent<T> {
  const settlement = deferred<void>();
  void settlement.promise.catch(() => undefined);
  return { payload, settlement, state: 'pending' };
}

function rejectIntent<T>(intent: PendingHostIntent<T> | undefined, error: Error): void {
  if (!intent || intent.state === 'settled') return;
  intent.state = 'settled';
  intent.settlement.reject(error);
}

function appendBoundedTail(current: Buffer, bytes: Buffer): Buffer {
  if (bytes.byteLength >= UTILITY_STDERR_TAIL_MAX_BYTES) {
    return Buffer.from(bytes.subarray(-UTILITY_STDERR_TAIL_MAX_BYTES));
  }
  const retainedPrefix = current.subarray(
    Math.max(0, current.byteLength + bytes.byteLength - UTILITY_STDERR_TAIL_MAX_BYTES),
  );
  return Buffer.concat([retainedPrefix, bytes]);
}

function assertTerminalMatchesObservedFrames(
  terminal: SandboxUtilityTerminalPayload,
  evaluatorFrames: readonly SandboxUtilityEvaluatorFramePayload[],
  evaluatorPid: number | undefined,
): void {
  const snapshotFrames = terminal.control.acceptedFrames;
  if (snapshotFrames.length !== evaluatorFrames.length
    || snapshotFrames.some((frame, index) => frame !== evaluatorFrames[index]?.frame)) {
    throw new Error('sandbox utility terminal control does not match observed evaluator frames');
  }
  if (terminal.control.evaluatorPid !== evaluatorPid) {
    throw new Error('sandbox utility terminal evaluator pid does not match observed evaluator pid');
  }
}

function requireAvailable(
  closedReason: Error | undefined,
  transportFailure: Error | undefined,
): void {
  if (closedReason) throw closedReason;
  if (transportFailure) throw transportFailure;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function waitForObservedExit(
  exit: Promise<SandboxUtilityProcessExit>,
  deadlineMs: number,
  timeoutMessage: string,
): Promise<SandboxUtilityProcessExit> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<SandboxUtilityProcessExit>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutMessage)), deadlineMs);
  });
  return Promise.race([exit, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
