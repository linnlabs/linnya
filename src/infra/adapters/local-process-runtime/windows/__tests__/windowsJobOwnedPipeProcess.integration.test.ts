import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import type { OwnedPipeProcess } from '../../../../../shared/process-runtime';
import { createWindowsJobOwnedPipeProcessLauncher } from '../createWindowsJobOwnedPipeProcess';
import type {
  WindowsOwnedPipeNativeBinding,
  WindowsOwnedPipeNativeLaunchInput,
  WindowsOwnedPipeNativeOutputChannel,
  WindowsOwnedPipeNativeProcess,
} from '../definitions/windowsOwnedPipeNativeBinding';

type NativeObserver = (payload: unknown) => boolean;

class FakeWindowsOwnedPipeNativeProcess implements WindowsOwnedPipeNativeProcess {
  private observer: NativeObserver | undefined;
  readonly resumeOutputCalls: WindowsOwnedPipeNativeOutputChannel[] = [];
  readonly cancelOutputCalls: WindowsOwnedPipeNativeOutputChannel[] = [];
  terminateCalls = 0;
  releaseCalls = 0;
  resumeAfterReadyCalls = 0;
  onResumeOutput: ((channel: WindowsOwnedPipeNativeOutputChannel) => void) | undefined;
  onTerminate: (() => void) | undefined;
  onStartObservers: (() => void) | undefined;
  startObserversError: Error | undefined;
  terminateError: Error | undefined;
  resumeAfterReadyError: Error | undefined;

  startObservers(callback: NativeObserver): void {
    this.observer = callback;
    this.onStartObservers?.();
    if (this.startObserversError) throw this.startObserversError;
  }

  resumeAfterObserversReady(): void {
    this.resumeAfterReadyCalls += 1;
    if (this.resumeAfterReadyError) throw this.resumeAfterReadyError;
  }

  resumeOutput(channel: WindowsOwnedPipeNativeOutputChannel): void {
    this.resumeOutputCalls.push(channel);
    this.onResumeOutput?.(channel);
  }

  cancelOutput(channel: WindowsOwnedPipeNativeOutputChannel): void {
    this.cancelOutputCalls.push(channel);
  }

  async terminateAndWaitTreeEmpty(): Promise<void> {
    this.terminateCalls += 1;
    this.onTerminate?.();
    if (this.terminateError) throw this.terminateError;
  }

  async release(): Promise<void> {
    this.releaseCalls += 1;
  }

  emitData(channel: WindowsOwnedPipeNativeOutputChannel, bytes: Uint8Array): boolean {
    return this.requireObserver()([channel, bytes, null, null]);
  }

  emitEof(channel: WindowsOwnedPipeNativeOutputChannel): boolean {
    return this.requireObserver()([`${channel}_eof`, null, null, null]);
  }

  emitRootExit(exitCode = 0): boolean {
    return this.requireObserver()(['root_exit', null, exitCode, null]);
  }

  emitInvalid(payload: unknown): boolean {
    return this.requireObserver()(payload);
  }

  private requireObserver(): NativeObserver {
    if (!this.observer) throw new Error('fake native observers have not started');
    return this.observer;
  }
}

function createHarness(input: {
  readonly configureNative?: (native: FakeWindowsOwnedPipeNativeProcess) => void;
  readonly abortSignal?: AbortSignal;
} = {}): Promise<{
  readonly native: FakeWindowsOwnedPipeNativeProcess;
  readonly process: OwnedPipeProcess;
}> {
  const native = new FakeWindowsOwnedPipeNativeProcess();
  input.configureNative?.(native);
  const binding: WindowsOwnedPipeNativeBinding = {
    createWindowsOwnedPipeProcess(_launch: WindowsOwnedPipeNativeLaunchInput) {
      return native;
    },
  };
  const launch = createWindowsJobOwnedPipeProcessLauncher(binding);
  return launch({
    executablePath: 'C:\\runtime\\node.exe',
    argv: ['fixture.js'],
    cwd: 'C:\\conversation',
    environment: { LINNYA_TEST: 'true' },
  }, { abortSignal: input.abortSignal }).then(process => ({ native, process }));
}

function settleNormally(
  native: FakeWindowsOwnedPipeNativeProcess,
  exitCode = 0,
): void {
  native.emitEof('stdout');
  native.emitEof('stderr');
  native.emitRootExit(exitCode);
}

describe('Windows Job owned pipe adapter', () => {
  it('不会把早于 push(false) 的读取请求预存成下一块输出许可', async () => {
    const { native, process } = await createHarness();
    process.stdout.read(0);
    await waitForImmediate();

    expect(native.emitData('stdout', Buffer.alloc(64 * 1024, 0x41))).toBe(false);
    expect(process.stdout.readableLength).toBe(64 * 1024);
    expect(native.resumeOutputCalls).toEqual([]);

    expect(process.stdout.read()?.length).toBe(64 * 1024);
    await waitForImmediate();
    expect(native.resumeOutputCalls).toEqual(['stdout']);

    settleNormally(native);
    await expect(process.rootClose).resolves.toBeUndefined();
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
  });

  it('无人消费 128 MiB 时保持有界，开始消费后完整恢复且 stdout 不阻塞 stderr', async () => {
    const totalBytes = 128 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x4f);
    let remainingBytes = totalBytes;
    let pumping = false;
    const { native, process } = await createHarness({
      configureNative(candidate) {
        candidate.onResumeOutput = channel => {
          if (channel === 'stdout') void waitForImmediate().then(pump);
        };
      },
    });

    function pump(): void {
      if (pumping) return;
      pumping = true;
      while (remainingBytes > 0) {
        const accepted = native.emitData('stdout', chunk);
        remainingBytes -= chunk.length;
        if (!accepted) break;
      }
      pumping = false;
      if (remainingBytes === 0) native.emitEof('stdout');
    }

    pump();
    expect(remainingBytes).toBe(totalBytes - chunk.length);
    expect(process.stdout.readableLength).toBe(chunk.length);

    const stderrChunks: Buffer[] = [];
    process.stderr.on('data', (bytes: Buffer) => stderrChunks.push(Buffer.from(bytes)));
    expect(native.emitData('stderr', Buffer.from('stderr-independent'))).toBe(true);
    native.emitEof('stderr');

    let receivedBytes = 0;
    let invalidByte = false;
    process.stdout.on('data', (bytes: Buffer) => {
      receivedBytes += bytes.length;
      if (!bytes.every(byte => byte === 0x4f)) invalidByte = true;
    });
    native.emitRootExit(0);
    await expect(process.rootClose).resolves.toBeUndefined();
    expect(receivedBytes).toBe(totalBytes);
    expect(invalidByte).toBe(false);
    expect(Buffer.concat(stderrChunks).toString('utf8')).toBe('stderr-independent');
    expect(native.resumeOutputCalls.filter(channel => channel === 'stderr')).toEqual([]);
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
  });

  it('暂停后销毁可解除 native 等待，并保持 stop/release Promise 身份稳定', async () => {
    const { native, process } = await createHarness();
    expect(native.emitData('stdout', Buffer.alloc(64 * 1024))).toBe(false);

    const firstStop = process.stopAndWaitForTreeEmpty();
    const secondStop = process.stopAndWaitForTreeEmpty();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toEqual({ status: 'succeeded' });

    process.stdout.destroy();
    native.emitEof('stderr');
    native.emitRootExit(1);
    await waitForImmediate();
    expect(native.cancelOutputCalls).toContain('stdout');

    const firstRelease = process.release();
    const secondRelease = process.release();
    expect(secondRelease).toBe(firstRelease);
    await expect(firstRelease).resolves.toEqual({ status: 'succeeded' });
    expect(native.terminateCalls).toBe(1);
    expect(native.releaseCalls).toBe(1);
  });

  it('destroy 与已经在途的 data 交错时安静拒收，不误报 observer failure', async () => {
    const { native, process } = await createHarness();
    process.stdout.destroy();
    expect(native.emitData('stdout', Buffer.from('late-in-flight-byte'))).toBe(false);
    expect(native.emitEof('stdout')).toBe(true);
    native.emitEof('stderr');
    native.emitRootExit(0);

    await expect(process.rootExit).resolves.toEqual({ exitCode: 0, signal: null });
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
  });

  it('观察协议失败时仍释放资源，而不是让 rootClose 的拒绝跳过 release', async () => {
    const { native, process } = await createHarness();
    process.stdout.on('error', () => {});
    process.stderr.on('error', () => {});

    native.emitInvalid(['stdout', 'not-bytes', null, null]);
    await expect(process.rootExit).rejects.toThrow('must contain bytes');
    await expect(process.rootClose).rejects.toThrow('must contain bytes');
    await expect(process.release()).resolves.toEqual({ status: 'succeeded' });
    expect(native.cancelOutputCalls).toEqual(expect.arrayContaining(['stdout', 'stderr']));
    expect(native.releaseCalls).toBe(1);
  });

  it('observers 建立后发生 abort 时异步终止并释放，不在同步入口互等', async () => {
    const abortController = new AbortController();
    let native: FakeWindowsOwnedPipeNativeProcess | undefined;
    await expect(createHarness({
      abortSignal: abortController.signal,
      configureNative(candidate) {
        native = candidate;
        candidate.onStartObservers = () => abortController.abort();
        candidate.onTerminate = () => candidate.emitRootExit(1);
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(native?.terminateCalls).toBe(1);
    expect(native?.releaseCalls).toBe(1);
    expect(native?.resumeAfterReadyCalls).toBe(0);
  });

  it('observer callback 构建失败时只走 native 已完成的启动回滚', async () => {
    const failure = new Error('observer callback build failed');
    let native: FakeWindowsOwnedPipeNativeProcess | undefined;
    await expect(createHarness({
      configureNative(candidate) {
        native = candidate;
        candidate.startObserversError = failure;
      },
    })).rejects.toBe(failure);
    expect(native?.terminateCalls).toBe(0);
    expect(native?.releaseCalls).toBe(1);
    expect(native?.resumeAfterReadyCalls).toBe(0);
  });

  it('同步观察失败后 startObservers 再抛错时先等待 stop，并保留启动与 stop 错误', async () => {
    const startError = new Error('startObservers failed after callback');
    const stopError = new Error('tree termination failed');
    let native: FakeWindowsOwnedPipeNativeProcess | undefined;
    await expect(createHarness({
      configureNative(candidate) {
        native = candidate;
        candidate.terminateError = stopError;
        candidate.startObserversError = startError;
        candidate.onStartObservers = () => {
          candidate.emitInvalid(['stdout', 'not-bytes', null, null]);
        };
      },
    })).rejects.toMatchObject({
      name: 'OwnedPipeProcessStartupCleanupError',
      cause: startError,
      treeCleanup: { status: 'failed', error: stopError },
      resourceRelease: { status: 'succeeded' },
    });
    expect(native?.terminateCalls).toBe(1);
    expect(native?.releaseCalls).toBe(1);
    expect(native?.resumeAfterReadyCalls).toBe(0);
  });

  it('owner 交付前收到观察失败时拒绝启动且不产生未监听的 stream error', async () => {
    let native: FakeWindowsOwnedPipeNativeProcess | undefined;
    await expect(createHarness({
      configureNative(candidate) {
        native = candidate;
        candidate.onStartObservers = () => {
          candidate.emitInvalid(['stdout', 'not-bytes', null, null]);
        };
      },
    })).rejects.toThrow('must contain bytes');
    expect(native?.resumeAfterReadyCalls).toBe(0);
    expect(native?.terminateCalls).toBe(1);
    expect(native?.releaseCalls).toBe(1);
  });

  it('放行调用失败后不再声称用户代码一定未启动，并保留清理事实', async () => {
    const commitError = new Error('resume failed after committing native state');
    let native: FakeWindowsOwnedPipeNativeProcess | undefined;
    await expect(createHarness({
      configureNative(candidate) {
        native = candidate;
        candidate.resumeAfterReadyError = commitError;
        candidate.onTerminate = () => candidate.emitRootExit(1);
      },
    })).rejects.toMatchObject({
      name: 'OwnedPipeProcessStartupCleanupError',
      cause: commitError,
      treeCleanup: { status: 'succeeded' },
      resourceRelease: { status: 'succeeded' },
    });
    expect(native?.resumeAfterReadyCalls).toBe(1);
    expect(native?.terminateCalls).toBe(1);
    expect(native?.releaseCalls).toBe(1);
  });
});
