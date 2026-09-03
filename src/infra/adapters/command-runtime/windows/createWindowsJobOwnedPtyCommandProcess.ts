import { Readable } from 'node:stream';

import type { ProcessInteractionActionV1 } from '@app/schemas/commands';

import { OwnedPtyCommandProcessStartupCleanupError } from '../runner/definitions/ownedPtyCommandProcess';
import type {
  LaunchOwnedPtyCommandProcess,
  OwnedPtyCommandProcess,
} from '../runner/definitions/ownedPtyCommandProcess';
import type {
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../shared/process-runtime';
import type {
  WindowsOwnedPtyNativeBinding,
  WindowsOwnedPtyNativeProcess,
} from './definitions/windowsOwnedPtyNativeBinding';
import { parseWindowsOwnedPtyNativeEvent } from './functions/parseWindowsOwnedPtyNativeEvent';

const TERMINAL_READABLE_HIGH_WATER_MARK_BYTES = 64 * 1024;
const WINDOWS_PTY_EOF_KEYS = Uint8Array.of(0x1a, 0x0d);
const WINDOWS_PTY_ENTER_KEY = Uint8Array.of(0x0d);
const UTF8_ENCODER = new TextEncoder();

interface Deferred<T> {
  readonly promise: Promise<T>;
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

function launchAbortedError(): Error {
  const error = new Error('Windows PTY process owner launch was aborted');
  error.name = 'AbortError';
  return error;
}

class WindowsPtyTerminalReadable extends Readable {
  private pushInProgress = false;
  private readRequestedDuringPush = false;
  private nativePaused = false;
  private nativeEnded = false;

  constructor(
    private readonly nativeProcess: WindowsOwnedPtyNativeProcess,
    private readonly settleClosed: () => void,
    private readonly reportFailure: (error: Error) => void,
  ) {
    super({ highWaterMark: TERMINAL_READABLE_HIGH_WATER_MARK_BYTES });
  }

  accept(bytes: Uint8Array): boolean {
    if (this.nativeEnded) throw new Error('Windows native PTY delivered bytes after terminal EOF');
    if (this.destroyed) return false;
    this.pushInProgress = true;
    this.readRequestedDuringPush = false;
    let accepted: boolean;
    try {
      // callback 返回后 native Buffer 生命周期已经结束，Readable 必须持有自己的 byte。
      accepted = this.push(Buffer.from(bytes));
    } finally {
      this.pushInProgress = false;
    }
    if (this.destroyed) return false;
    this.nativePaused = !accepted;
    if (this.nativePaused && this.readRequestedDuringPush) this.resumeNativeOutput();
    this.readRequestedDuringPush = false;
    return accepted && !this.destroyed;
  }

  finish(): void {
    if (this.nativeEnded) throw new Error('Windows native PTY delivered terminal EOF twice');
    this.nativeEnded = true;
    this.push(null);
    this.settleClosed();
  }

  override _read(): void {
    if (this.nativePaused) {
      this.resumeNativeOutput();
    } else if (this.pushInProgress) {
      this.readRequestedDuringPush = true;
    }
  }

  private resumeNativeOutput(): void {
    this.nativePaused = false;
    try {
      this.nativeProcess.resumeOutput();
    } catch (error) {
      this.reportFailure(toError(error, 'Windows native PTY output resume failed'));
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    let finalError = error;
    this.nativePaused = false;
    this.pushInProgress = false;
    this.readRequestedDuringPush = false;
    try {
      this.nativeProcess.cancelOutput();
    } catch (cancelError) {
      finalError ??= toError(cancelError, 'Windows native PTY output cancel failed');
      this.reportFailure(finalError);
    }
    this.settleClosed();
    callback(finalError);
  }
}

function createOwnedProcess(input: {
  readonly nativeProcess: WindowsOwnedPtyNativeProcess;
  readonly options: OwnedPipeProcessLaunchOptions;
  readonly terminal: WindowsPtyTerminalReadable;
  readonly terminalClosed: Deferred<void>;
  readonly rootExit: Deferred<OwnedProcessRootExit>;
  readonly rootReleaseReady: Deferred<void>;
  readonly backendFailure: Deferred<Error>;
}): OwnedPtyCommandProcess {
  let acceptingInput = true;
  let stopPromise: Promise<OwnedProcessTreeStopResult> | undefined;
  let releasePromise: Promise<OwnedProcessResourceReleaseResult> | undefined;
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();

  function stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult> {
    if (stopPromise) return stopPromise;
    // 终止意图一旦提交，任何迟到 write/resize 都不能再触达 ConPTY native handle。
    // 这条门与树清理是否尚在等待无关，并与 macOS PTY owner 保持同一公开合同。
    acceptingInput = false;
    stopPromise = input.nativeProcess.terminateAndWaitTreeEmpty().then(
      () => ({ status: 'succeeded' as const }),
      error => ({
        status: 'failed' as const,
        error: toError(error, 'Windows PTY process tree cleanup failed'),
      }),
    );
    void stopPromise.then((result) => {
      treeEmpty.resolve(result);
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
            `Windows PTY resources cannot be released before tree cleanup: ${treeResult.error.message}`,
          ),
        };
      }
      try {
        await input.rootReleaseReady.promise;
        // ClosePseudoConsole 可能正是 terminal EOF 的触发点，所以必须先进入 native
        // release。若 input writer 仍活，native 会在关闭 HPCON 前拒绝本次释放；此时
        // terminal 合理地不会 EOF，必须立即把失败交给调用方以允许重试，不能反过来等它。
        await input.nativeProcess.release();
        await input.terminalClosed.promise;
        input.options.abortSignal?.removeEventListener('abort', stopAfterAbort);
        return { status: 'succeeded' };
      } catch (error) {
        return {
          status: 'failed',
          error: toError(error, 'Windows PTY process owner resource release failed'),
        };
      }
    })();
    void releasePromise.then((result) => {
      // native 在 input writer 尚未停止时会拒绝越过 HPCON 关闭边界；这种失败没有
      // 消耗资源所有权，下一次 release 必须能够重新观察，而不能被旧 Promise 永久锁死。
      if (result.status === 'failed') releasePromise = undefined;
    });
    return releasePromise;
  }

  const stopAfterAbort = (): void => {
    void stopAndWaitForTreeEmpty();
  };
  input.options.abortSignal?.addEventListener('abort', stopAfterAbort, { once: true });
  if (input.options.abortSignal?.aborted) stopAfterAbort();
  void input.rootExit.promise.then(stopAfterAbort, stopAfterAbort);

  return Object.freeze({
    terminal: input.terminal,
    rootExit: input.rootExit.promise,
    treeEmpty: treeEmpty.promise,
    backendFailure: input.backendFailure.promise,
    async interact(action: ProcessInteractionActionV1): Promise<void> {
      if (!acceptingInput) throw new Error('Windows PTY input is closed');
      if (action.type === 'resize') {
        input.nativeProcess.resize(action.columns, action.rows);
        return;
      }
      if (action.type === 'eof') {
        // Windows ConPTY 的 EOF 是 Ctrl+Z + CR 按键语义，不承诺目标 CLI 因此退出。
        await input.nativeProcess.writeInput(WINDOWS_PTY_EOF_KEYS);
        return;
      }
      const bytes = UTF8_ENCODER.encode(action.input);
      if (action.type === 'submit') {
        await input.nativeProcess.writeInput(Buffer.concat([bytes, WINDOWS_PTY_ENTER_KEY]));
      } else {
        await input.nativeProcess.writeInput(bytes);
      }
    },
    stopAndWaitForTreeEmpty,
    release,
  });
}

async function failAfterNativeAdmission(
  owner: OwnedPtyCommandProcess,
  terminal: WindowsPtyTerminalReadable,
  originalError: unknown,
): Promise<never> {
  terminal.destroy();
  const treeCleanup = await owner.stopAndWaitForTreeEmpty();
  const resourceRelease = await owner.release();
  throw new OwnedPtyCommandProcessStartupCleanupError(
    'Windows PTY process owner failed before delivery',
    treeCleanup,
    resourceRelease,
    { cause: originalError },
  );
}

/**
 * 把同一 Windows native runtime 中的 Pseudoconsole + Job owner 映射为平台 PTY
 * 合同。本层不解析终端屏幕，也不把 transcript 声称为 child 原始 stdout。
 */
export function createWindowsJobOwnedPtyCommandProcessLauncher(
  binding: WindowsOwnedPtyNativeBinding,
): LaunchOwnedPtyCommandProcess {
  return async (launch, options = {}) => {
    if (options.abortSignal?.aborted) throw launchAbortedError();
    const nativeProcess = binding.createWindowsOwnedPtyProcess(
      {
        executablePath: launch.executablePath,
        argv: [...launch.argv],
        cwd: launch.cwd,
        environment: Object.entries(launch.environment).map(([name, value]) => ({ name, value })),
      },
      launch.terminalSize.columns,
      launch.terminalSize.rows,
    );
    const rootExit = deferred<OwnedProcessRootExit>();
    void rootExit.promise.catch(() => {});
    const rootReleaseReady = deferred<void>();
    const terminalClosed = deferred<void>();
    const backendFailure = deferred<Error>();
    let reportTerminalFailure = (_error: Error): void => {};
    const terminal = new WindowsPtyTerminalReadable(
      nativeProcess,
      () => terminalClosed.resolve(),
      error => reportTerminalFailure(error),
    );
    let observerFailure: Error | undefined;
    let ownerAdmitted = false;
    let stopAfterObserverFailure = (): void => {};

    const failObservers = (error: Error): void => {
      if (observerFailure) return;
      observerFailure = error;
      backendFailure.resolve(error);
      rootReleaseReady.resolve();
      rootExit.reject(error);
      terminal.destroy(ownerAdmitted ? error : undefined);
      stopAfterObserverFailure();
    };
    reportTerminalFailure = failObservers;

    const observe = (payload: unknown): boolean => {
      try {
        const event = parseWindowsOwnedPtyNativeEvent(payload);
        if (event.kind === 'terminal_data') return terminal.accept(event.bytes);
        if (event.kind === 'terminal_eof') {
          terminal.finish();
          return true;
        }
        if (event.kind === 'root_exit') {
          rootReleaseReady.resolve();
          rootExit.resolve({ exitCode: event.exitCode, signal: null });
          return true;
        }
        failObservers(new Error(`Windows native PTY observer failed: ${event.message}`));
      } catch (error) {
        failObservers(toError(error, 'Windows native PTY observer returned an invalid event'));
      }
      return true;
    };

    try {
      nativeProcess.startObservers(observe);
    } catch (error) {
      terminal.destroy();
      let treeCleanup: OwnedProcessTreeStopResult;
      try {
        await nativeProcess.terminateAndWaitTreeEmpty();
        treeCleanup = { status: 'succeeded' };
      } catch (stopError) {
        treeCleanup = {
          status: 'failed',
          error: toError(stopError, 'Windows PTY startup tree cleanup failed'),
        };
      }
      let resourceRelease: OwnedProcessResourceReleaseResult;
      try {
        await nativeProcess.release();
        resourceRelease = { status: 'succeeded' };
      } catch (releaseError) {
        resourceRelease = {
          status: 'failed',
          error: toError(releaseError, 'Windows PTY native release failed'),
        };
      }
      if (treeCleanup.status === 'failed' || resourceRelease.status === 'failed') {
        throw new OwnedPtyCommandProcessStartupCleanupError(
          'Windows PTY observer startup cleanup failed',
          treeCleanup,
          resourceRelease,
          { cause: error },
        );
      }
      throw error;
    }

    const owner = createOwnedProcess({
      nativeProcess,
      options,
      terminal,
      terminalClosed,
      rootExit,
      rootReleaseReady,
      backendFailure,
    });
    stopAfterObserverFailure = (): void => {
      void owner.stopAndWaitForTreeEmpty();
    };
    if (observerFailure) return failAfterNativeAdmission(owner, terminal, observerFailure);
    if (options.abortSignal?.aborted) return failAfterNativeAdmission(owner, terminal, launchAbortedError());
    try {
      nativeProcess.resumeAfterObserversReady();
    } catch (error) {
      return failAfterNativeAdmission(owner, terminal, error);
    }
    ownerAdmitted = true;
    return owner;
  };
}
