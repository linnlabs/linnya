import { Readable } from 'node:stream';

import { OwnedPipeProcessStartupCleanupError } from '../../../../shared/process-runtime';
import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcess,
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../shared/process-runtime';
import type {
  WindowsOwnedPipeNativeBinding,
  WindowsOwnedPipeNativeOutputChannel,
  WindowsOwnedPipeNativeProcess,
} from './definitions/windowsOwnedPipeNativeBinding';
import { parseWindowsOwnedPipeNativeEvent } from './functions/parseWindowsOwnedPipeNativeEvent';

const OUTPUT_READABLE_HIGH_WATER_MARK_BYTES = 64 * 1024;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
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
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

function toError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message);
}

class WindowsProcessCleanupError extends Error {
  readonly errors: readonly Error[];

  constructor(message: string, errors: readonly Error[]) {
    super(message);
    this.name = 'WindowsProcessCleanupError';
    this.errors = Object.freeze([...errors]);
  }
}

function createLaunchAbortedError(): Error {
  const error = new Error('Windows process owner launch was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfLaunchAborted(options: OwnedPipeProcessLaunchOptions): void {
  if (options.abortSignal?.aborted) throw createLaunchAbortedError();
}

class WindowsNativeOutputReadable extends Readable {
  private pushInProgress = false;
  private readRequestedDuringPush = false;
  private nativePaused = false;
  private nativeEnded = false;

  constructor(
    private readonly channel: WindowsOwnedPipeNativeOutputChannel,
    private readonly resumeNativeOutput: (channel: WindowsOwnedPipeNativeOutputChannel) => void,
    private readonly cancelNativeOutput: (channel: WindowsOwnedPipeNativeOutputChannel) => void,
    private readonly settleClosed: () => void,
  ) {
    super({ highWaterMark: OUTPUT_READABLE_HIGH_WATER_MARK_BYTES });
  }

  accept(bytes: Uint8Array): boolean {
    if (this.nativeEnded) {
      throw new Error(`Windows native ${this.channel} delivered bytes after stream close`);
    }
    // cancel 与已经排入 TSFN 的 data 可以交错；destroy 后到达的一条在途 byte 属于
    // 正常取消并返回 false，不能升级成 observer failure。EOF 后再来 data 才是协议错误。
    if (this.destroyed) return false;
    // Buffer 必须取得 byte 所有权；native callback 返回后不能依赖外部 ArrayBuffer 生命周期。
    // Node 可能在本次 push 之前或 push 内同步调用 _read。只有 push 内的请求能解除本次
    // push(false)，更早的 _read 只是索取当前块，不能预先放行下一次 native ReadFile。
    this.pushInProgress = true;
    this.readRequestedDuringPush = false;
    let accepted: boolean;
    try {
      accepted = this.push(Buffer.from(bytes));
    } finally {
      this.pushInProgress = false;
    }
    if (this.destroyed) return false;
    this.nativePaused = !accepted;
    if (this.nativePaused && this.readRequestedDuringPush) {
      this.readRequestedDuringPush = false;
      this.resumePausedNativeOutput();
    } else {
      this.readRequestedDuringPush = false;
    }
    return accepted && !this.destroyed;
  }

  finish(): void {
    if (this.nativeEnded) {
      throw new Error(`Windows native ${this.channel} delivered EOF more than once`);
    }
    this.nativeEnded = true;
    this.push(null);
    this.settleClosed();
  }

  override _read(): void {
    if (this.nativePaused) {
      this.resumePausedNativeOutput();
      return;
    }
    if (this.pushInProgress) this.readRequestedDuringPush = true;
  }

  private resumePausedNativeOutput(): void {
    this.nativePaused = false;
    try {
      this.resumeNativeOutput(this.channel);
    } catch (error) {
      this.destroy(toError(error, `Windows native ${this.channel} resume failed`));
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    let finalError = error;
    this.pushInProgress = false;
    this.readRequestedDuringPush = false;
    this.nativePaused = false;
    try {
      // destroy 表示下游明确放弃该流，必须永久取消 native reader；若只 resume，
      // 下一块 byte 仍可能再次进入无人消费的 Readable，release 也无法可靠 join。
      this.cancelNativeOutput(this.channel);
    } catch (cancelError) {
      const normalizedCancelError = toError(
        cancelError,
        `Windows native ${this.channel} cancel failed`,
      );
      finalError = finalError
        ? new WindowsProcessCleanupError(
            `Windows native ${this.channel} stream and cleanup both failed`,
            [finalError, normalizedCancelError],
          )
        : normalizedCancelError;
    }
    this.settleClosed();
    callback(finalError);
  }
}

function createOwnedProcess(input: {
  readonly nativeProcess: WindowsOwnedPipeNativeProcess;
  readonly options: OwnedPipeProcessLaunchOptions;
  readonly stdout: WindowsNativeOutputReadable;
  readonly stderr: WindowsNativeOutputReadable;
  readonly rootExit: Deferred<OwnedProcessRootExit>;
  readonly rootReleaseReady: Deferred<void>;
  readonly stdoutClosed: Deferred<void>;
  readonly stderrClosed: Deferred<void>;
}): OwnedPipeProcess {
  let stopPromise: Promise<OwnedProcessTreeStopResult> | undefined;
  let releasePromise: Promise<OwnedProcessResourceReleaseResult> | undefined;
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  const rootClose = Promise.all([
    input.rootExit.promise,
    input.stdoutClosed.promise,
    input.stderrClosed.promise,
  ]).then(() => undefined);
  // Promise 会原样暴露给调用方；内部 catch 只避免“launcher 尚未交付 owner”的
  // 失败窗口触发未处理拒绝，不吞掉调用方随后观察到的同一个错误。
  void rootClose.catch(() => {});
  const javascriptReleaseAdmission = Promise.all([
    input.rootReleaseReady.promise,
    input.stdoutClosed.promise,
    input.stderrClosed.promise,
  ]);

  function stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult> {
    if (stopPromise) return stopPromise;
    stopPromise = input.nativeProcess.terminateAndWaitTreeEmpty().then(
      () => ({ status: 'succeeded' as const }),
      error => ({
        status: 'failed' as const,
        error: toError(error, 'Windows process tree cleanup failed'),
      }),
    );
    void stopPromise.then((result) => {
      treeEmpty.resolve(result);
      // Job 已空本身就证明 root 不再运行。即使 root_exit 的 JavaScript callback
      // 丢失，也必须允许 release 进入 native 复核，不能永远卡在回调投递屏障。
      if (result.status === 'succeeded') input.rootReleaseReady.resolve();
    });
    return stopPromise;
  }

  function release(): Promise<OwnedProcessResourceReleaseResult> {
    if (releasePromise) return releasePromise;
    releasePromise = (async () => {
      const treeResult = await stopAndWaitForTreeEmpty();
      if (treeResult.status === 'failed') {
        return {
          status: 'failed',
          error: new Error(
            `Windows resources cannot be released before tree cleanup: ${treeResult.error.message}`,
          ),
        };
      }
      try {
        // 这道屏障只证明 JavaScript 已观察 root 终态并关闭或放弃两条 stream，允许
        // 进入 native release；Rust observer 是否真正退出，仍由异步 release 的 join 证明。
        await javascriptReleaseAdmission;
        await input.nativeProcess.release();
        input.options.abortSignal?.removeEventListener('abort', stopAfterAbort);
        return { status: 'succeeded' };
      } catch (error) {
        return {
          status: 'failed',
          error: toError(error, 'Windows process owner resource release failed'),
        };
      }
    })();
    return releasePromise;
  }

  const stopAfterAbort = (): void => {
    void stopAndWaitForTreeEmpty();
  };
  input.options.abortSignal?.addEventListener('abort', stopAfterAbort, { once: true });
  if (input.options.abortSignal?.aborted) stopAfterAbort();
  void input.rootExit.promise.then(stopAfterAbort, stopAfterAbort);

  return Object.freeze({
    stdout: input.stdout,
    stderr: input.stderr,
    rootExit: input.rootExit.promise,
    rootClose,
    treeEmpty: treeEmpty.promise,
    stopAndWaitForTreeEmpty,
    release,
  });
}

async function releaseAfterObserverStartFailure(
  nativeProcess: WindowsOwnedPipeNativeProcess,
  originalError: unknown,
  pendingStop?: Promise<void>,
): Promise<never> {
  let stopError: Error | undefined;
  if (pendingStop) {
    try {
      await pendingStop;
    } catch (error) {
      stopError = toError(error, 'Windows process tree cleanup failed before owner admission');
    }
  }
  try {
    // startObservers 的 native 合同保证抛错前已阻止用户代码并启动回滚；异步 release
    // 在 worker 中 join 可能仍在投递终态的 observer，不能改回 JS 主线程同步等待。
    await nativeProcess.release();
  } catch (releaseError) {
    throw new OwnedPipeProcessStartupCleanupError(
      'Windows process owner startup and native cleanup both failed',
      stopError
        ? { status: 'failed', error: stopError }
        : {
            status: 'failed',
            error: new Error('Windows startup tree cleanup was not independently proven'),
          },
      {
        status: 'failed',
        error: toError(releaseError, 'Windows native resource cleanup failed'),
      },
      { cause: originalError },
    );
  }
  if (stopError) {
    throw new OwnedPipeProcessStartupCleanupError(
      'Windows process owner startup tree cleanup failed',
      { status: 'failed', error: stopError },
      { status: 'succeeded' },
      { cause: originalError },
    );
  }
  throw originalError;
}

async function releaseAfterStartedLaunchFailure(
  ownedProcess: OwnedPipeProcess,
  stdout: WindowsNativeOutputReadable,
  stderr: WindowsNativeOutputReadable,
  originalError: unknown,
): Promise<never> {
  // 进程尚未交给调用方，失败后不会再有人消费输出。主动 destroy 才能解除可能的
  // push(false)，否则 release 会等不到 pipe observer 退出。
  stdout.destroy();
  stderr.destroy();
  const treeResult = await ownedProcess.stopAndWaitForTreeEmpty();
  const releaseResult = await ownedProcess.release();
  throw new OwnedPipeProcessStartupCleanupError(
    'Windows process owner failed at the user-code commit point',
    treeResult,
    releaseResult,
    { cause: originalError },
  );
}

async function releaseBeforeUserCodeCommit(
  ownedProcess: OwnedPipeProcess,
  stdout: WindowsNativeOutputReadable,
  stderr: WindowsNativeOutputReadable,
  originalError: unknown,
): Promise<never> {
  stdout.destroy();
  stderr.destroy();
  const treeResult = await ownedProcess.stopAndWaitForTreeEmpty();
  const releaseResult = await ownedProcess.release();
  if (treeResult.status === 'failed' || releaseResult.status === 'failed') {
    throw new OwnedPipeProcessStartupCleanupError(
      'Windows process owner failed before user-code commit and rollback was incomplete',
      treeResult,
      releaseResult,
      { cause: originalError },
    );
  }
  throw originalError;
}

/**
 * 把一次性 runner 持有的 native Job/pipe 适配为公共 owner 合同。binding 由下一层
 * manifest loader 显式注入；本模块不读取 Electron、PATH、cwd，也不公开 PID/native handle。
 */
export function createWindowsJobOwnedPipeProcessLauncher(
  binding: WindowsOwnedPipeNativeBinding,
): LaunchOwnedPipeProcess {
  return async (launch, options = {}) => {
    throwIfLaunchAborted(options);
    const nativeProcess = binding.createWindowsOwnedPipeProcess({
      executablePath: launch.executablePath,
      argv: [...launch.argv],
      cwd: launch.cwd,
      environment: Object.entries(launch.environment).map(([name, value]) => ({ name, value })),
    });
    const rootExit = deferred<OwnedProcessRootExit>();
    void rootExit.promise.catch(() => {});
    const rootReleaseReady = deferred<void>();
    const stdoutClosed = deferred<void>();
    const stderrClosed = deferred<void>();
    const stdout = new WindowsNativeOutputReadable('stdout', channel => {
      nativeProcess.resumeOutput(channel);
    }, channel => nativeProcess.cancelOutput(channel), () => stdoutClosed.resolve());
    const stderr = new WindowsNativeOutputReadable('stderr', channel => {
      nativeProcess.resumeOutput(channel);
    }, channel => nativeProcess.cancelOutput(channel), () => stderrClosed.resolve());
    let observerFailure: Error | undefined;
    let ownerAdmitted = false;
    let preOwnershipStopPromise: Promise<void> | undefined;
    let stopAfterObserverFailure = (): void => {
      preOwnershipStopPromise ??= nativeProcess.terminateAndWaitTreeEmpty();
      void preOwnershipStopPromise.catch(() => {});
    };

    const failObservers = (error: Error): void => {
      if (observerFailure) return;
      observerFailure = error;
      rootReleaseReady.resolve();
      rootExit.reject(error);
      // owner 尚未交付时没有调用方能监听 stream error；启动 Promise 会携带原错误。
      // 交付后则保留标准 Node stream error 语义。
      stdout.destroy(ownerAdmitted ? error : undefined);
      stderr.destroy(ownerAdmitted ? error : undefined);
      stopAfterObserverFailure();
    };

    const observe = (payload: unknown): boolean => {
      try {
        const event = parseWindowsOwnedPipeNativeEvent(payload);
        if (event.kind === 'data') {
          return (event.channel === 'stdout' ? stdout : stderr).accept(event.bytes);
        }
        if (event.kind === 'eof') {
          const stream = event.channel === 'stdout' ? stdout : stderr;
          stream.finish();
          return true;
        }
        if (event.kind === 'root_exit') {
          rootReleaseReady.resolve();
          rootExit.resolve({ exitCode: event.exitCode, signal: null });
          return true;
        }
        failObservers(new Error(`Windows native observer failed: ${event.message}`));
      } catch (error) {
        failObservers(toError(error, 'Windows native observer returned an invalid event'));
      }
      // 失败事件也必须确认本条 callback，避免 native reader 卡在已知失败的 in-flight byte。
      return true;
    };

    try {
      nativeProcess.startObservers(observe);
    } catch (error) {
      return releaseAfterObserverStartFailure(
        nativeProcess,
        error,
        preOwnershipStopPromise,
      );
    }
    if (observerFailure) {
      return releaseAfterObserverStartFailure(
        nativeProcess,
        observerFailure,
        preOwnershipStopPromise,
      );
    }
    const ownedProcess = createOwnedProcess({
      nativeProcess,
      options,
      stdout,
      stderr,
      rootExit,
      rootReleaseReady,
      stdoutClosed,
      stderrClosed,
    });
    stopAfterObserverFailure = (): void => {
      void ownedProcess.stopAndWaitForTreeEmpty();
    };
    try {
      throwIfLaunchAborted(options);
    } catch (error) {
      return releaseBeforeUserCodeCommit(ownedProcess, stdout, stderr, error);
    }
    try {
      // native 调用一旦开始，就不能再证明用户代码没有被放行。即使调用同步抛错，
      // 也必须按“可能已启动”收树并向 runner 交付清理事实。
      nativeProcess.resumeAfterObserversReady();
      ownerAdmitted = true;
      return ownedProcess;
    } catch (error) {
      return releaseAfterStartedLaunchFailure(ownedProcess, stdout, stderr, error);
    }
  };
}
