import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron';
import { Logger } from '../../shared/logger.js';

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 800;
const DEFAULT_MAX_CONSECUTIVE_TIMEOUTS = 3;

interface HiddenWorkerIpcEventLike {
  sender: HiddenWorkerWebContentsLike;
}

interface RenderProcessGoneDetailsLike {
  reason: string;
  exitCode: number;
}

type UnknownListener = (...args: unknown[]) => void;

export interface HiddenWorkerWebContentsLike {
  send(channel: string, payload: unknown): void;
  on(event: string, listener: UnknownListener): void;
  off(event: string, listener: UnknownListener): void;
  isDestroyed(): boolean;
  getOSProcessId(): number;
}

export interface HiddenWorkerBrowserWindowLike {
  readonly webContents: HiddenWorkerWebContentsLike;
  loadFile(filePath: string): Promise<void>;
  close(): void;
  on(event: 'closed', listener: () => void): this;
  off(event: 'closed', listener: () => void): this;
  isDestroyed(): boolean;
}

export interface HiddenWorkerIpcMainLike {
  on(channel: string, listener: (event: HiddenWorkerIpcEventLike, payload: unknown) => void): void;
  off(channel: string, listener: (event: HiddenWorkerIpcEventLike, payload: unknown) => void): void;
}

export interface HiddenWorkerRequestEnvelope {
  readonly requestId: string;
  readonly payload: unknown;
}

export interface HiddenWorkerResponseEnvelope<TResponse> {
  readonly requestId: string;
  readonly response: TResponse;
}

interface HiddenWorkerHostBaseOptions<TRequest, TResponse> {
  readonly workerId: string;
  readonly requestChannel: string;
  readonly responseChannel: string;
  readonly readyChannel: string;
  readonly workerHtmlPath: string;
  readonly preloadPath: string;
  readonly partition?: string;
  readonly createRequestPayload: (request: TRequest) => HiddenWorkerRequestEnvelope;
  readonly parseResponsePayload: (payload: unknown) => HiddenWorkerResponseEnvelope<TResponse>;
  readonly parseReadyPayload: (payload: unknown) => void;
  readonly extractRequestIdFromInvalidPayload?: (payload: unknown) => string | null;
  readonly createBrowserWindow?: (options: BrowserWindowConstructorOptions) => HiddenWorkerBrowserWindowLike;
  readonly ipcMain?: HiddenWorkerIpcMainLike;
  readonly idleTimeoutMs?: number;
  readonly readyTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxConsecutiveTimeouts?: number;
  readonly logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export type HiddenWorkerHostOptions<TRequest, TResponse> =
  HiddenWorkerHostBaseOptions<TRequest, TResponse> & (
    | {
        readonly cancelChannel: string;
        readonly createCancelPayload: (requestId: string, request: TRequest) => unknown;
      }
    | {
        readonly cancelChannel?: never;
        readonly createCancelPayload?: never;
      }
  );

interface PendingRequest<TResponse> {
  readonly sender: HiddenWorkerWebContentsLike;
  readonly timeoutHandle: ReturnType<typeof setTimeout>;
  readonly removeAbortListener: () => void;
  resolve: (response: TResponse) => void;
  reject: (error: Error) => void;
}

interface LifecycleRecord {
  readonly closed: () => void;
  readonly renderProcessGone: UnknownListener;
  readonly webContents: HiddenWorkerWebContentsLike;
}

function isWindowDestroyed(window: HiddenWorkerBrowserWindowLike | null): boolean {
  return window == null || window.isDestroyed() || window.webContents.isDestroyed();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function extractRequestIdFromRecord(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const requestId = Reflect.get(payload, 'requestId');
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : null;
}

function readRenderProcessGoneDetails(details: unknown): RenderProcessGoneDetailsLike {
  if (details == null || typeof details !== 'object') {
    return { reason: 'unknown', exitCode: Number.NaN };
  }
  const reason = Reflect.get(details, 'reason');
  const exitCode = Reflect.get(details, 'exitCode');
  return {
    reason: typeof reason === 'string' && reason.length > 0 ? reason : 'unknown',
    exitCode: typeof exitCode === 'number' ? exitCode : Number.NaN,
  };
}

function normalizeWorkerId(workerId: string): string {
  const normalized = workerId.trim();
  if (!normalized) {
    throw new Error('HiddenWorkerHost.workerId 不能为空');
  }
  return normalized;
}

export class HiddenWorkerHost<TRequest, TResponse> {
  private readonly workerId: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;
  private readonly readyChannel: string;
  private readonly cancelChannel: string | undefined;
  private readonly workerHtmlPath: string;
  private readonly preloadPath: string;
  private readonly partition: string;
  private readonly createRequestPayload: (request: TRequest) => HiddenWorkerRequestEnvelope;
  private readonly parseResponsePayload: (payload: unknown) => HiddenWorkerResponseEnvelope<TResponse>;
  private readonly parseReadyPayload: (payload: unknown) => void;
  private readonly createCancelPayload: ((requestId: string, request: TRequest) => unknown) | undefined;
  private readonly extractRequestIdFromInvalidPayload: (payload: unknown) => string | null;
  private readonly createBrowserWindow: (options: BrowserWindowConstructorOptions) => HiddenWorkerBrowserWindowLike;
  private readonly ipcMainLike: HiddenWorkerIpcMainLike;
  private readonly idleTimeoutMs: number;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxConsecutiveTimeouts: number;
  private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  private readonly responseListener: (event: HiddenWorkerIpcEventLike, payload: unknown) => void;
  private readonly lifecycleMap = new WeakMap<HiddenWorkerBrowserWindowLike, LifecycleRecord>();

  private workerWindow: HiddenWorkerBrowserWindowLike | null = null;
  private spawnPromise: Promise<HiddenWorkerBrowserWindowLike> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private consecutiveTimeouts = 0;
  private readonly pendingRequests = new Map<string, PendingRequest<TResponse>>();

  constructor(options: HiddenWorkerHostOptions<TRequest, TResponse>) {
    this.workerId = normalizeWorkerId(options.workerId);
    this.requestChannel = options.requestChannel;
    this.responseChannel = options.responseChannel;
    this.readyChannel = options.readyChannel;
    this.cancelChannel = options.cancelChannel;
    this.workerHtmlPath = options.workerHtmlPath;
    this.preloadPath = options.preloadPath;
    this.partition = options.partition ?? `hidden-worker:${this.workerId}`;
    this.createRequestPayload = options.createRequestPayload;
    this.parseResponsePayload = options.parseResponsePayload;
    this.parseReadyPayload = options.parseReadyPayload;
    this.createCancelPayload = options.createCancelPayload;
    this.extractRequestIdFromInvalidPayload = options.extractRequestIdFromInvalidPayload ?? extractRequestIdFromRecord;
    this.createBrowserWindow = options.createBrowserWindow
      ?? ((windowOptions) => new BrowserWindow(windowOptions));
    this.ipcMainLike = options.ipcMain ?? ipcMain;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxConsecutiveTimeouts = Math.max(1, options.maxConsecutiveTimeouts ?? DEFAULT_MAX_CONSECUTIVE_TIMEOUTS);
    this.logger = options.logger ?? new Logger(`HiddenWorker:${this.workerId}`);
    this.responseListener = (event, payload) => {
      this.handleResponse(event, payload);
    };

    this.ipcMainLike.on(this.responseChannel, this.responseListener);
  }

  async ensureReady(): Promise<HiddenWorkerBrowserWindowLike> {
    if (this.disposed) {
      throw new Error(`Hidden worker host has been disposed: ${this.workerId}`);
    }
    // spawnWorker 会在 ready 前先持有窗口，后续并发调用必须共享启动 Promise；
    // 否则会把尚未完成协议握手的窗口提前暴露给 Backend。
    if (this.spawnPromise != null) {
      return this.spawnPromise;
    }
    const existing = this.workerWindow;
    if (existing && !isWindowDestroyed(existing)) {
      return existing;
    }

    this.spawnPromise = this.spawnWorker();
    try {
      return await this.spawnPromise;
    } finally {
      this.spawnPromise = null;
    }
  }

  async invoke(
    requestInput: TRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TResponse> {
    options.signal?.throwIfAborted();
    const workerWindow = await this.ensureReady();
    const request = this.createRequestPayload(requestInput);
    options.signal?.throwIfAborted();

    this.clearIdleTimer();

    return await new Promise<TResponse>((resolve, reject) => {
      const cancelWorkerRequest = (): void => {
        if (!this.cancelChannel || !this.createCancelPayload) return;
        try {
          workerWindow.webContents.send(
            this.cancelChannel,
            this.createCancelPayload(request.requestId, requestInput),
          );
        } catch {
          // worker 已退出时，本地 pending rejection 仍是稳定终态，不用 send 错误覆盖它。
        }
      };
      const timeoutHandle = setTimeout(() => {
        const pendingRequest = this.pendingRequests.get(request.requestId);
        if (!pendingRequest) return;
        cancelWorkerRequest();
        this.consecutiveTimeouts += 1;
        const timeoutCount = this.consecutiveTimeouts;
        if (timeoutCount >= this.maxConsecutiveTimeouts) {
          this.logger.warn(
            `hidden_worker.id=${this.workerId} consecutive_timeouts=${timeoutCount} ` +
            `threshold=${this.maxConsecutiveTimeouts} forcing dispose`,
          );
          this.consecutiveTimeouts = 0;
          this.handleWorkerUnavailable(
            workerWindow,
            new Error(`Hidden worker hung: ${this.workerId}, ${timeoutCount} consecutive timeouts.`),
          );
          if (!isWindowDestroyed(workerWindow)) {
            workerWindow.close();
          }
          return;
        } else {
          this.scheduleIdleClose();
        }
        pendingRequest.reject(
          new Error(`Hidden worker request timed out: ${this.workerId} after ${this.requestTimeoutMs}ms.`),
        );
      }, this.requestTimeoutMs);

      const abort = (): void => {
        const pendingRequest = this.pendingRequests.get(request.requestId);
        if (!pendingRequest) return;
        cancelWorkerRequest();
        pendingRequest.reject(new Error(`Hidden worker request cancelled: ${this.workerId}.`));
      };

      this.pendingRequests.set(request.requestId, {
        sender: workerWindow.webContents,
        timeoutHandle,
        removeAbortListener: () => options.signal?.removeEventListener('abort', abort),
        resolve: (response) => {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(request.requestId);
          options.signal?.removeEventListener('abort', abort);
          this.consecutiveTimeouts = 0;
          this.touch();
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(request.requestId);
          options.signal?.removeEventListener('abort', abort);
          this.scheduleIdleClose();
          reject(error);
        },
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();

      try {
        if (!this.pendingRequests.has(request.requestId)) return;
        workerWindow.webContents.send(this.requestChannel, request.payload);
      } catch (error) {
        const pendingRequest = this.pendingRequests.get(request.requestId);
        pendingRequest?.reject(toError(error));
      }
    });
  }

  touch(): void {
    this.scheduleIdleClose();
  }

  readProcessIdentity(): { readonly workerId: string; readonly pid: number } | null {
    const win = this.workerWindow;
    if (!win || isWindowDestroyed(win)) return null;
    const pid = win.webContents.getOSProcessId();
    return pid > 0 ? { workerId: this.workerId, pid } : null;
  }

  /** 协议 codec 在 Backend 拒绝 payload 时，只销毁当前窗口；注册仍可在下次调用时重建。 */
  invalidate(reason: string): void {
    const win = this.workerWindow;
    if (!win || isWindowDestroyed(win)) {
      return;
    }
    const error = new Error(`Hidden worker invalidated: ${this.workerId}, ${reason}`);
    this.handleWorkerUnavailable(win, error);
    if (!isWindowDestroyed(win)) {
      win.close();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearIdleTimer();
    this.ipcMainLike.off(this.responseChannel, this.responseListener);
    this.rejectPendingRequestsForSender(null, new Error(`Hidden worker host disposed: ${this.workerId}`));

    const win = this.workerWindow;
    if (win && !isWindowDestroyed(win)) {
      win.close();
    }
    this.workerWindow = null;
    this.clearIdleTimer();
  }

  private async spawnWorker(): Promise<HiddenWorkerBrowserWindowLike> {
    const startedAt = Date.now();
    const workerWindow = this.createBrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        sandbox: true,
        partition: this.partition,
        devTools: false,
        webSecurity: true,
      },
    });

    this.workerWindow = workerWindow;
    this.attachLifecycle(workerWindow);

    const readyPromise = this.waitForWorkerReady(workerWindow);
    try {
      // load 与 ready 必须从一开始就共同被等待。若 loadFile 先失败后窗口关闭，
      // 独立的 ready Promise 会再次 reject，形成未处理的生命周期异常。
      await Promise.all([
        workerWindow.loadFile(this.workerHtmlPath),
        readyPromise,
      ]);

      if (this.disposed) {
        this.detachLifecycle(workerWindow);
        if (!workerWindow.isDestroyed()) {
          workerWindow.close();
        }
        throw new Error(`Hidden worker host disposed during spawn: ${this.workerId}`);
      }

      this.logger.info(`hidden_worker.id=${this.workerId} spawn success durationMs=${Date.now() - startedAt}`);
      this.touch();
      return workerWindow;
    } catch (error) {
      this.logger.error(`hidden_worker.id=${this.workerId} spawn failed durationMs=${Date.now() - startedAt}`, error);
      if (this.workerWindow === workerWindow) {
        this.workerWindow = null;
      }
      this.detachLifecycle(workerWindow);
      if (!workerWindow.isDestroyed()) {
        workerWindow.close();
      }
      throw toError(error);
    }
  }

  private waitForWorkerReady(workerWindow: HiddenWorkerBrowserWindowLike): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const readyWebContents = workerWindow.webContents;
      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`Hidden worker did not become ready within ${this.readyTimeoutMs}ms: ${this.workerId}`));
      }, this.readyTimeoutMs);

      const handleReady = (event: HiddenWorkerIpcEventLike, payload: unknown): void => {
        if (event.sender !== readyWebContents) {
          return;
        }

        try {
          this.parseReadyPayload(payload);
          cleanup();
          resolve();
        } catch (error) {
          cleanup();
          reject(toError(error));
        }
      };

      const handleClosed = (): void => {
        cleanup();
        reject(new Error(`Hidden worker closed before it became ready: ${this.workerId}`));
      };

      const handleRenderProcessGone = (_event: unknown, details: unknown): void => {
        const crashDetails = readRenderProcessGoneDetails(details);
        cleanup();
        reject(new Error(`Hidden worker crashed before ready: ${this.workerId}, ${crashDetails.reason}`));
      };

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
        this.ipcMainLike.off(this.readyChannel, handleReady);
        try {
          workerWindow.off('closed', handleClosed);
        } catch {
          // ready 阶段可能正好撞上窗口销毁；销毁后事件不会再触发，跳过清理即可。
        }
        try {
          readyWebContents.off('render-process-gone', handleRenderProcessGone);
        } catch {
          // 同上，避免 destroyed race 把 ready 失败路径变成二次异常。
        }
      };

      this.ipcMainLike.on(this.readyChannel, handleReady);
      workerWindow.on('closed', handleClosed);
      readyWebContents.on('render-process-gone', handleRenderProcessGone);
    });
  }

  private attachLifecycle(workerWindow: HiddenWorkerBrowserWindowLike): void {
    const cachedWebContents = workerWindow.webContents;

    const handleClosed = (): void => {
      this.handleWorkerUnavailable(workerWindow, new Error(`Hidden worker window closed: ${this.workerId}`));
    };

    const handleRenderProcessGone = (_event: unknown, details: unknown): void => {
      const crashDetails = readRenderProcessGoneDetails(details);
      this.logger.warn(
        `hidden_worker.id=${this.workerId} crashed reason=${crashDetails.reason} exitCode=${crashDetails.exitCode}`,
      );
      this.handleWorkerUnavailable(
        workerWindow,
        new Error(`Hidden worker renderer exited: ${this.workerId}, ${crashDetails.reason}`),
      );
    };

    const record: LifecycleRecord = {
      closed: handleClosed,
      renderProcessGone: handleRenderProcessGone,
      webContents: cachedWebContents,
    };

    workerWindow.on('closed', record.closed);
    cachedWebContents.on('render-process-gone', record.renderProcessGone);
    this.lifecycleMap.set(workerWindow, record);
  }

  private detachLifecycle(workerWindow: HiddenWorkerBrowserWindowLike): void {
    const record = this.lifecycleMap.get(workerWindow);
    if (record == null) {
      return;
    }
    if (!workerWindow.isDestroyed()) {
      try {
        workerWindow.off('closed', record.closed);
      } catch {
        // destroyed race：closed 后原生对象可能已经不可访问，跳过即可。
      }
    }
    if (!record.webContents.isDestroyed()) {
      try {
        record.webContents.off('render-process-gone', record.renderProcessGone);
      } catch {
        // destroyed race：closed 后原生对象可能已经不可访问，跳过即可。
      }
    }
    this.lifecycleMap.delete(workerWindow);
  }

  private handleWorkerUnavailable(workerWindow: HiddenWorkerBrowserWindowLike, error: Error): void {
    if (this.workerWindow === workerWindow) {
      this.workerWindow = null;
    }
    this.clearIdleTimer();
    const record = this.lifecycleMap.get(workerWindow);
    const cachedWebContents = record?.webContents ?? null;
    this.rejectPendingRequestsForSender(cachedWebContents, error);
    this.detachLifecycle(workerWindow);
  }

  private rejectPendingRequestsForSender(sender: HiddenWorkerWebContentsLike | null, error: Error): void {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      if (sender != null && pendingRequest.sender !== sender) {
        continue;
      }
      this.pendingRequests.delete(requestId);
      clearTimeout(pendingRequest.timeoutHandle);
      pendingRequest.removeAbortListener();
      pendingRequest.reject(error);
    }
  }

  private handleResponse(event: HiddenWorkerIpcEventLike, payload: unknown): void {
    let response: HiddenWorkerResponseEnvelope<TResponse>;
    try {
      response = this.parseResponsePayload(payload);
    } catch (error) {
      this.logger.warn(`hidden_worker.id=${this.workerId} invalid response payload, disposing worker`, error);
      const requestId = this.extractRequestIdFromInvalidPayload(payload);
      const protocolError = new Error(
        `hidden_worker.id=${this.workerId} invalid response payload: ${toError(error).message}`,
      );
      if (requestId != null) {
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest != null && pendingRequest.sender === event.sender) {
          this.pendingRequests.delete(requestId);
          clearTimeout(pendingRequest.timeoutHandle);
          pendingRequest.removeAbortListener();
          pendingRequest.reject(protocolError);
        }
      }
      const offendingWorker = this.findWorkerBySender(event.sender);
      if (offendingWorker != null) {
        this.handleWorkerUnavailable(offendingWorker, protocolError);
        if (!isWindowDestroyed(offendingWorker)) {
          offendingWorker.close();
        }
      }
      return;
    }

    const pendingRequest = this.pendingRequests.get(response.requestId);
    if (pendingRequest == null || pendingRequest.sender !== event.sender) {
      return;
    }

    pendingRequest.resolve(response.response);
  }

  private findWorkerBySender(sender: HiddenWorkerWebContentsLike): HiddenWorkerBrowserWindowLike | null {
    const current = this.workerWindow;
    if (current == null) {
      return null;
    }
    const record = this.lifecycleMap.get(current);
    return record?.webContents === sender ? current : null;
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    if (this.disposed) {
      return;
    }
    if (this.pendingRequests.size > 0 || isWindowDestroyed(this.workerWindow)) {
      return;
    }

    this.idleTimer = setTimeout(() => {
      if (this.pendingRequests.size > 0 || isWindowDestroyed(this.workerWindow)) {
        return;
      }
      this.logger.info(`hidden_worker.id=${this.workerId} idle_close`);
      this.workerWindow?.close();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer == null) {
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
