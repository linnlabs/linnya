import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow {},
  ipcMain: {},
}));

import {
  HiddenWorkerHost,
  type HiddenWorkerBrowserWindowLike,
  type HiddenWorkerIpcMainLike,
  type HiddenWorkerWebContentsLike,
} from './HiddenWorkerHost';

type WebContentsListener = Parameters<HiddenWorkerWebContentsLike['on']>[1];
type IpcListener = Parameters<HiddenWorkerIpcMainLike['on']>[1];

class FakeWebContents implements HiddenWorkerWebContentsLike {
  private static nextPid = 10_000;
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  private readonly listeners = new Map<string, Set<WebContentsListener>>();
  private readonly pid = FakeWebContents.nextPid++;

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  on(event: string, listener: WebContentsListener): void {
    const listeners = this.listeners.get(event) ?? new Set<WebContentsListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: WebContentsListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  isDestroyed(): boolean {
    return false;
  }

  getOSProcessId(): number {
    return this.pid;
  }
}

class FakeIpcMain implements HiddenWorkerIpcMainLike {
  private readonly listeners = new Map<string, Set<IpcListener>>();

  on(channel: string, listener: IpcListener): void {
    const listeners = this.listeners.get(channel) ?? new Set<IpcListener>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  off(channel: string, listener: IpcListener): void {
    this.listeners.get(channel)?.delete(listener);
  }

  emit(channel: string, sender: HiddenWorkerWebContentsLike, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener({ sender }, payload);
    }
  }
}

class FakeWindow implements HiddenWorkerBrowserWindowLike {
  readonly webContents = new FakeWebContents();
  private readonly closedListeners = new Set<() => void>();
  private destroyed = false;

  constructor(
    private readonly ipcMain: FakeIpcMain,
    private readonly readyChannel: string,
    private readonly autoReady = true,
  ) {}

  async loadFile(): Promise<void> {
    if (this.autoReady) {
      queueMicrotask(() => this.emitReady());
    }
  }

  emitReady(): void {
    this.ipcMain.emit(this.readyChannel, this.webContents, {});
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const listener of this.closedListeners) listener();
  }

  on(_event: 'closed', listener: () => void): this {
    this.closedListeners.add(listener);
    return this;
  }

  off(_event: 'closed', listener: () => void): this {
    this.closedListeners.delete(listener);
    return this;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function createHost(input: {
  readonly supportsCancellation: boolean;
  readonly requestTimeoutMs?: number;
  readonly autoReady?: boolean;
}) {
  const ipcMain = new FakeIpcMain();
  const window = new FakeWindow(ipcMain, 'worker:ready', input.autoReady);
  const common = {
    workerId: 'test-worker',
    requestChannel: 'worker:request',
    responseChannel: 'worker:response',
    readyChannel: 'worker:ready',
    workerHtmlPath: '/tmp/worker.html',
    preloadPath: '/tmp/preload.js',
    createRequestPayload: (request: { readonly requestId: string }) => ({
      requestId: request.requestId,
      payload: request,
    }),
    parseResponsePayload: (payload: unknown) => ({ requestId: 'unused', response: payload }),
    parseReadyPayload: () => undefined,
    createBrowserWindow: () => window,
    ipcMain,
    requestTimeoutMs: input.requestTimeoutMs ?? 5_000,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const host = input.supportsCancellation
    ? new HiddenWorkerHost({
        ...common,
        cancelChannel: 'worker:cancel',
        createCancelPayload: requestId => ({ requestId }),
      })
    : new HiddenWorkerHost(common);
  return { host, window };
}

describe('HiddenWorkerHost cancellation', () => {
  it('并发调用共享尚未 ready 的启动过程，不提前公开 worker 窗口', async () => {
    const fixture = createHost({ supportsCancellation: false, autoReady: false });

    const firstReady = fixture.host.ensureReady();
    const secondReady = fixture.host.ensureReady();
    let secondResolved = false;
    void secondReady.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);

    fixture.window.emitReady();
    await expect(Promise.all([firstReady, secondReady])).resolves.toEqual([
      fixture.window,
      fixture.window,
    ]);
    await fixture.host.dispose();
  });

  it('worker 就绪后公开稳定的 workerId 与操作系统 pid', async () => {
    const fixture = createHost({ supportsCancellation: false });

    expect(fixture.host.readProcessIdentity()).toBeNull();
    await fixture.host.ensureReady();
    expect(fixture.host.readProcessIdentity()).toEqual({
      workerId: 'test-worker',
      pid: fixture.window.webContents.getOSProcessId(),
    });

    await fixture.host.dispose();
    expect(fixture.host.readProcessIdentity()).toBeNull();
  });

  it('支持取消协议时按 requestId 通知 worker，并拒绝本地 pending', async () => {
    const fixture = createHost({ supportsCancellation: true });
    const abortController = new AbortController();
    const invocation = fixture.host.invoke(
      { requestId: 'request-1' },
      { signal: abortController.signal },
    );
    await vi.waitFor(() => {
      expect(fixture.window.webContents.sent).toHaveLength(1);
    });

    abortController.abort();
    await expect(invocation).rejects.toThrow('Hidden worker request cancelled');
    expect(fixture.window.webContents.sent).toEqual([
      { channel: 'worker:request', payload: { requestId: 'request-1' } },
      { channel: 'worker:cancel', payload: { requestId: 'request-1' } },
    ]);
    await fixture.host.dispose();
  });

  it('未声明取消协议的 worker 只收口本地 pending，不发送伪造 channel', async () => {
    const fixture = createHost({ supportsCancellation: false });
    const abortController = new AbortController();
    const invocation = fixture.host.invoke(
      { requestId: 'request-2' },
      { signal: abortController.signal },
    );
    await vi.waitFor(() => {
      expect(fixture.window.webContents.sent).toHaveLength(1);
    });

    abortController.abort();
    await expect(invocation).rejects.toThrow('Hidden worker request cancelled');
    expect(fixture.window.webContents.sent).toEqual([
      { channel: 'worker:request', payload: { requestId: 'request-2' } },
    ]);
    await fixture.host.dispose();
  });

  it('请求超时也按 requestId 通知支持取消的 worker', async () => {
    const fixture = createHost({ supportsCancellation: true, requestTimeoutMs: 10 });

    await expect(fixture.host.invoke({ requestId: 'request-timeout' }))
      .rejects.toThrow('Hidden worker request timed out');
    expect(fixture.window.webContents.sent).toEqual([
      { channel: 'worker:request', payload: { requestId: 'request-timeout' } },
      { channel: 'worker:cancel', payload: { requestId: 'request-timeout' } },
    ]);
    await fixture.host.dispose();
  });
});
