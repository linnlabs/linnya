import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import type { OwnedPtyCommandProcess } from '../../runner/definitions/ownedPtyCommandProcess';
import { createWindowsJobOwnedPtyCommandProcessLauncher } from '../createWindowsJobOwnedPtyCommandProcess';
import type {
  WindowsOwnedPtyNativeBinding,
  WindowsOwnedPtyNativeProcess,
} from '../definitions/windowsOwnedPtyNativeBinding';

type NativeObserver = (payload: unknown) => boolean;

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`operation did not settle within ${milliseconds}ms`)),
      milliseconds,
    );
    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class FakeWindowsOwnedPtyNativeProcess implements WindowsOwnedPtyNativeProcess {
  private observer: NativeObserver | undefined;
  readonly writes: Uint8Array[] = [];
  readonly resizes: Array<{ readonly columns: number; readonly rows: number }> = [];
  resumeOutputCalls = 0;
  cancelOutputCalls = 0;
  terminateCalls = 0;
  releaseCalls = 0;
  resumeAfterReadyCalls = 0;
  onResumeOutput: (() => void) | undefined;
  onRelease: (() => void) | undefined;
  onStartObservers: (() => void) | undefined;
  startObserversError: Error | undefined;
  resumeError: Error | undefined;
  terminateError: Error | undefined;
  releaseError: Error | undefined;

  startObservers(callback: NativeObserver): void {
    this.observer = callback;
    this.onStartObservers?.();
    if (this.startObserversError) throw this.startObserversError;
  }

  resumeAfterObserversReady(): void {
    this.resumeAfterReadyCalls += 1;
    if (this.resumeError) throw this.resumeError;
  }

  async writeInput(data: Uint8Array): Promise<number> {
    this.writes.push(Uint8Array.from(data));
    return data.byteLength;
  }

  resize(columns: number, rows: number): void {
    this.resizes.push({ columns, rows });
  }

  resumeOutput(): void {
    this.resumeOutputCalls += 1;
    this.onResumeOutput?.();
  }

  cancelOutput(): void {
    this.cancelOutputCalls += 1;
  }

  async terminateAndWaitTreeEmpty(): Promise<void> {
    this.terminateCalls += 1;
    if (this.terminateError) throw this.terminateError;
  }

  async release(): Promise<void> {
    this.releaseCalls += 1;
    this.onRelease?.();
    if (this.releaseError) throw this.releaseError;
  }

  emitData(bytes: Uint8Array): boolean {
    return this.requireObserver()(['terminal_data', bytes, null, null]);
  }

  emitTerminalEof(): boolean {
    return this.requireObserver()(['terminal_eof', null, null, null]);
  }

  emitRootExit(exitCode = 0): boolean {
    return this.requireObserver()(['root_exit', null, exitCode, null]);
  }

  emitInvalid(payload: unknown): boolean {
    return this.requireObserver()(payload);
  }

  private requireObserver(): NativeObserver {
    if (!this.observer) throw new Error('fake PTY observers have not started');
    return this.observer;
  }
}

async function createHarness(
  configure?: (native: FakeWindowsOwnedPtyNativeProcess) => void,
): Promise<{
  readonly native: FakeWindowsOwnedPtyNativeProcess;
  readonly process: OwnedPtyCommandProcess;
}> {
  const native = new FakeWindowsOwnedPtyNativeProcess();
  configure?.(native);
  const binding: WindowsOwnedPtyNativeBinding = {
    createWindowsOwnedPtyProcess() {
      return native;
    },
  };
  const launch = createWindowsJobOwnedPtyCommandProcessLauncher(binding);
  const process = await launch({
    executablePath: 'C:\\runtime\\pwsh.exe',
    argv: ['-NoLogo'],
    cwd: 'C:\\conversation',
    environment: { LINNYA_TEST: 'true' },
    terminalSize: { columns: 80, rows: 24 },
  });
  return { native, process };
}

describe('Windows Job owned PTY adapter', () => {
  it('建立 observer 后才恢复 root，并把输入、EOF 与 resize 映射到同一个 native owner', async () => {
    const { native, process } = await createHarness();
    expect(native.resumeAfterReadyCalls).toBe(1);

    await expect(process.interact({ type: 'write', input: '中' })).resolves.toBeUndefined();
    await expect(process.interact({ type: 'submit', input: 'ok' })).resolves.toBeUndefined();
    await expect(process.interact({ type: 'eof' })).resolves.toBeUndefined();
    await expect(process.interact({ type: 'resize', columns: 123, rows: 45 }))
      .resolves.toBeUndefined();

    expect(native.writes).toEqual([
      Uint8Array.of(0xe4, 0xb8, 0xad),
      Uint8Array.of(0x6f, 0x6b, 0x0d),
      Uint8Array.of(0x1a, 0x0d),
    ]);
    expect(native.resizes).toEqual([{ columns: 123, rows: 45 }]);

    native.emitRootExit(0);
    const release = process.release();
    await waitForImmediate();
    native.emitTerminalEof();
    await expect(release).resolves.toEqual({ status: 'succeeded' });
  });

  it('terminal transcript 使用单流真实背压，消费后才恢复 native reader', async () => {
    const { native, process } = await createHarness();
    process.terminal.read(0);
    await waitForImmediate();

    expect(native.emitData(Buffer.alloc(64 * 1024, 0x41))).toBe(false);
    expect(native.resumeOutputCalls).toBe(0);
    expect(process.terminal.read()?.length).toBe(64 * 1024);
    await waitForImmediate();
    expect(native.resumeOutputCalls).toBe(1);

    native.emitRootExit(0);
    const release = process.release();
    native.emitTerminalEof();
    await expect(release).resolves.toEqual({ status: 'succeeded' });
  });

  it('tree empty 后立即启动 release，并与 terminal EOF 同时等待', async () => {
    let releaseEntered = false;
    const { native, process } = await createHarness((candidate) => {
      candidate.onRelease = () => {
        releaseEntered = true;
        candidate.emitTerminalEof();
      };
    });
    native.emitRootExit(0);

    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
    expect(releaseEntered).toBe(true);
    expect(native.terminateCalls).toBe(1);
    expect(native.releaseCalls).toBe(1);
  });

  it('停止意图提交后立即关闭输入门，不把迟到 resize 交给 native handle', async () => {
    const { native, process } = await createHarness();
    const stopping = process.stopAndWaitForTreeEmpty();

    await expect(process.interact({ type: 'resize', columns: 100, rows: 30 }))
      .rejects.toThrow('Windows PTY input is closed');
    await expect(stopping).resolves.toEqual({ status: 'succeeded' });
    expect(native.resizes).toEqual([]);

    native.emitRootExit(0);
    const release = process.release();
    native.emitTerminalEof();
    await expect(release).resolves.toEqual({ status: 'succeeded' });
  });

  it('销毁 terminal 会永久取消 native output，并保持 stop/release 幂等', async () => {
    const { native, process } = await createHarness();
    process.terminal.destroy();
    native.emitRootExit(1);

    const stop = process.stopAndWaitForTreeEmpty();
    expect(process.stopAndWaitForTreeEmpty()).toBe(stop);
    await expect(stop).resolves.toEqual({ status: 'succeeded' });
    const release = process.release();
    expect(process.release()).toBe(release);
    await expect(release).resolves.toEqual({ status: 'succeeded' });
    expect(native.cancelOutputCalls).toBe(1);
  });

  it('非法 native 事件会终止业务树并保留公开错误', async () => {
    const { native, process } = await createHarness();
    process.terminal.on('error', () => {});
    native.emitInvalid(['terminal_data', 'not-bytes', null, null]);

    await expect(process.rootExit).rejects.toThrow('must contain transcript bytes');
    await expect(process.backendFailure).resolves.toMatchObject({
      message: expect.stringContaining('must contain transcript bytes'),
    });
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
    expect(native.terminateCalls).toBe(1);
    expect(native.releaseCalls).toBe(1);
  });

  it('恢复 output 失败会进入 backendFailure，而不是只留一个无人处理的 stream error', async () => {
    const resumeError = new Error('resume output failed');
    const { native, process } = await createHarness((candidate) => {
      candidate.onResumeOutput = () => { throw resumeError; };
    });
    process.terminal.on('error', () => {});
    expect(native.emitData(Buffer.alloc(64 * 1024))).toBe(false);
    process.terminal.read();

    await expect(process.backendFailure).resolves.toBe(resumeError);
    await expect(process.rootExit).rejects.toBe(resumeError);
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
  });

  it('observer 启动同时触发 callback 失败与 stop 失败时保留独立清理事实', async () => {
    const startError = new Error('observer start failed');
    const stopError = new Error('tree cleanup failed');
    const native = new FakeWindowsOwnedPtyNativeProcess();
    native.startObserversError = startError;
    native.terminateError = stopError;
    native.onStartObservers = () => {
      native.emitInvalid(['terminal_data', 'not-bytes', null, null]);
    };
    const launch = createWindowsJobOwnedPtyCommandProcessLauncher({
      createWindowsOwnedPtyProcess() { return native; },
    });
    await expect(launch({
      executablePath: 'C:\\runtime\\pwsh.exe',
      argv: [],
      cwd: 'C:\\conversation',
      environment: {},
      terminalSize: { columns: 80, rows: 24 },
    })).rejects.toMatchObject({
      name: 'OwnedPtyCommandProcessStartupCleanupError',
      cause: startError,
      treeCleanup: { status: 'failed', error: stopError },
      resourceRelease: { status: 'succeeded' },
    });
  });

  it('observer 单纯同步失败也会真实停止树后释放，不依赖 callback 副作用', async () => {
    const startError = new Error('observer start failed');
    const native = new FakeWindowsOwnedPtyNativeProcess();
    native.startObserversError = startError;
    const launch = createWindowsJobOwnedPtyCommandProcessLauncher({
      createWindowsOwnedPtyProcess() { return native; },
    });

    await expect(launch({
      executablePath: 'C:\\runtime\\pwsh.exe',
      argv: [],
      cwd: 'C:\\conversation',
      environment: {},
      terminalSize: { columns: 80, rows: 24 },
    })).rejects.toBe(startError);
    expect(native.terminateCalls).toBe(1);
    expect(native.releaseCalls).toBe(1);
    expect(native.cancelOutputCalls).toBe(1);
  });

  it('native 可重试 release 失败时不等待尚未发生的 EOF，第二次关闭 HPCON 后才成功', async () => {
    const releaseError = new Error('input writer still running');
    const { native, process } = await createHarness((candidate) => {
      candidate.releaseError = releaseError;
    });
    native.emitRootExit(1);

    await expect(withTimeout(process.release(), 100)).resolves.toEqual({
      status: 'failed',
      error: releaseError,
    });
    expect(native.releaseCalls).toBe(1);
    expect(native.cancelOutputCalls).toBe(0);

    native.releaseError = undefined;
    native.onRelease = () => native.emitTerminalEof();
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
    expect(native.releaseCalls).toBe(2);
    expect(native.cancelOutputCalls).toBe(0);
  });

  it('resume 失败时不交付半启动 owner，并完成 tree 与资源清理', async () => {
    const resumeError = new Error('resume failed');
    const native = new FakeWindowsOwnedPtyNativeProcess();
    native.resumeError = resumeError;
    const binding: WindowsOwnedPtyNativeBinding = {
      createWindowsOwnedPtyProcess() {
        return native;
      },
    };
    const launch = createWindowsJobOwnedPtyCommandProcessLauncher(binding);
    await expect(launch({
      executablePath: 'C:\\runtime\\pwsh.exe',
      argv: [],
      cwd: 'C:\\conversation',
      environment: {},
      terminalSize: { columns: 80, rows: 24 },
    })).rejects.toMatchObject({
      name: 'OwnedPtyCommandProcessStartupCleanupError',
      cause: resumeError,
      treeCleanup: { status: 'succeeded' },
      resourceRelease: { status: 'succeeded' },
    });
    expect(native.terminateCalls).toBe(1);
    expect(native.releaseCalls).toBe(1);
    expect(native.cancelOutputCalls).toBe(1);
  });
});
