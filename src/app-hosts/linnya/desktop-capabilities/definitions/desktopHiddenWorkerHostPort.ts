export interface DesktopHiddenWorkerDescriptor {
  readonly id: string;
  readonly requestChannel: string;
  readonly responseChannel: string;
  readonly readyChannel: string;
  readonly workerHtmlPath: string;
  readonly preloadPath: string;
  readonly partition?: string;
  readonly cancelChannel?: string;
  readonly idleTimeoutMs?: number;
  readonly readyTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxConsecutiveTimeouts?: number;
}

export interface DesktopHiddenWorkerInvocation {
  readonly requestId: string;
  readonly payload: unknown;
  readonly cancelPayload?: unknown;
}

/**
 * Desktop 只托管隐藏 BrowserWindow 与原始 IPC envelope。插件 codec 留在 Backend，
 * 因此本端口可以由 reverse RPC 实现，不传函数、Electron 对象或领域实例。
 */
export interface DesktopHiddenWorkerHostPort {
  registerHiddenWorker(
    descriptor: DesktopHiddenWorkerDescriptor,
    options?: { readonly replace?: boolean },
  ): Promise<void>;
  unregisterHiddenWorker(workerId: string): Promise<boolean>;
  ensureHiddenWorkerReady(workerId: string): Promise<unknown>;
  touchHiddenWorker(workerId: string): void;
  invokeHiddenWorker(
    workerId: string,
    invocation: DesktopHiddenWorkerInvocation,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  invalidateHiddenWorker(workerId: string, reason: string): void;
}
