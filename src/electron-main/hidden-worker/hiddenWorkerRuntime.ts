import {
  HiddenWorkerHost,
  type HiddenWorkerHostOptions,
} from './HiddenWorkerHost.js';
import type {
  DesktopHiddenWorkerDescriptor,
  DesktopHiddenWorkerHostPort,
  DesktopHiddenWorkerInvocation,
} from '../../app-hosts/linnya/desktop-capabilities/index.js';

interface RegisteredHiddenWorkerHost {
  ensureReady(): Promise<unknown>;
  invoke(
    invocation: DesktopHiddenWorkerInvocation,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  touch(): void;
  invalidate(reason: string): void;
  readProcessIdentity(): { readonly workerId: string; readonly pid: number } | null;
  dispose(): Promise<void>;
}

const PROCESS_HIDDEN_WORKER_REGISTRY_KEY = '__linnyaProcessHiddenWorkerRegistryV1__' as const;

interface HiddenWorkerRegistryGlobal {
  [PROCESS_HIDDEN_WORKER_REGISTRY_KEY]?: Map<string, RegisteredHiddenWorkerHost>;
}

function getProcessHiddenWorkerRegistry(): Map<string, RegisteredHiddenWorkerHost> {
  const processGlobal: typeof globalThis & HiddenWorkerRegistryGlobal = globalThis;
  processGlobal[PROCESS_HIDDEN_WORKER_REGISTRY_KEY] ??= new Map();

  // 正式 Main、插件 CLI 与诊断模块可能由不同 bundle 内联本实现；同一宿主
  // 进程中的窗口身份必须共享，不能因为 bundle 边界丢失释放引用。
  return processGlobal[PROCESS_HIDDEN_WORKER_REGISTRY_KEY];
}

const hiddenWorkers = getProcessHiddenWorkerRegistry();

export async function registerHiddenWorker(
  definition: DesktopHiddenWorkerDescriptor,
  options: { readonly replace?: boolean } = {},
): Promise<void> {
  const workerId = normalizeWorkerId(definition.id);
  const existing = hiddenWorkers.get(workerId);
  if (existing) {
    if (options.replace !== true) {
      throw new Error(`Hidden worker 已注册: ${workerId}`);
    }
    hiddenWorkers.delete(workerId);
    await existing.dispose();
  }

  const cancellationOptions = definition.cancelChannel
    ? {
        cancelChannel: definition.cancelChannel,
        createCancelPayload: (
          _requestId: string,
          invocation: DesktopHiddenWorkerInvocation,
        ) => invocation.cancelPayload,
      }
    : {};
  let readyPayload: unknown;
  const hostOptions: HiddenWorkerHostOptions<DesktopHiddenWorkerInvocation, unknown> = {
    workerId,
    requestChannel: definition.requestChannel,
    responseChannel: definition.responseChannel,
    readyChannel: definition.readyChannel,
    workerHtmlPath: definition.workerHtmlPath,
    preloadPath: definition.preloadPath,
    partition: definition.partition,
    createRequestPayload: (invocation) => ({
      requestId: invocation.requestId,
      payload: invocation.payload,
    }),
    parseResponsePayload: (payload) => ({
      requestId: readRequiredRequestId(payload),
      response: payload,
    }),
    parseReadyPayload: (payload) => {
      readyPayload = payload;
    },
    ...cancellationOptions,
    idleTimeoutMs: definition.idleTimeoutMs,
    readyTimeoutMs: definition.readyTimeoutMs,
    requestTimeoutMs: definition.requestTimeoutMs,
    maxConsecutiveTimeouts: definition.maxConsecutiveTimeouts,
  };

  const host = new HiddenWorkerHost(hostOptions);
  hiddenWorkers.set(workerId, {
    ensureReady: async () => {
      await host.ensureReady();
      return readyPayload;
    },
    invoke: (invocation, invokeOptions) => host.invoke(invocation, invokeOptions),
    touch: () => host.touch(),
    invalidate: (reason) => host.invalidate(reason),
    readProcessIdentity: () => host.readProcessIdentity(),
    dispose: () => host.dispose(),
  });
}

export async function unregisterHiddenWorker(workerId: string): Promise<boolean> {
  const normalized = normalizeWorkerIdOrNull(workerId);
  if (!normalized) {
    return false;
  }
  const host = hiddenWorkers.get(normalized);
  if (!host) {
    return false;
  }
  hiddenWorkers.delete(normalized);
  await host.dispose();
  return true;
}

export function hasHiddenWorker(workerId: string): boolean {
  const normalized = normalizeWorkerIdOrNull(workerId);
  return normalized ? hiddenWorkers.has(normalized) : false;
}

export function listHiddenWorkerIds(): readonly string[] {
  return Array.from(hiddenWorkers.keys());
}

/** 只公开诊断所需的稳定身份，不泄露 BrowserWindow 或调度状态。 */
export function listHiddenWorkerProcessIdentities(): readonly {
  readonly workerId: string;
  readonly pid: number;
}[] {
  return Array.from(hiddenWorkers.values()).flatMap(host => {
    const identity = host.readProcessIdentity();
    return identity ? [identity] : [];
  });
}

export async function ensureHiddenWorkerReady(workerId: string): Promise<unknown> {
  const host = readHiddenWorker(workerId);
  return await host.ensureReady();
}

export function touchHiddenWorker(workerId: string): void {
  readHiddenWorker(workerId).touch();
}

export async function invokeHiddenWorker(
  workerId: string,
  invocation: DesktopHiddenWorkerInvocation,
  options: { readonly signal?: AbortSignal } = {},
): Promise<unknown> {
  return await readHiddenWorker(workerId).invoke(invocation, options);
}

export function invalidateHiddenWorker(workerId: string, reason: string): void {
  readHiddenWorker(workerId).invalidate(reason);
}

export async function clearHiddenWorkersForTests(): Promise<void> {
  const hosts = Array.from(hiddenWorkers.values());
  hiddenWorkers.clear();
  await Promise.all(hosts.map((host) => host.dispose()));
}

function readHiddenWorker(workerId: string): RegisteredHiddenWorkerHost {
  const normalized = normalizeWorkerId(workerId);
  const host = hiddenWorkers.get(normalized);
  if (!host) {
    throw new Error(`未知 hidden worker: ${normalized}`);
  }
  return host;
}

function normalizeWorkerId(workerId: string): string {
  const normalized = normalizeWorkerIdOrNull(workerId);
  if (!normalized) {
    throw new Error('HiddenWorker.id 不能为空');
  }
  return normalized;
}

function normalizeWorkerIdOrNull(workerId: string): string | null {
  const normalized = workerId.trim();
  return normalized.length > 0 ? normalized : null;
}

function readRequiredRequestId(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('Hidden worker response 缺少 requestId');
  }
  const requestId = Reflect.get(payload, 'requestId');
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Hidden worker response 缺少 requestId');
  }
  return requestId;
}

/** 当前 Electron 实现；App Server cutover 后由 reverse RPC adapter 实现同一 data-only 端口。 */
export const electronDesktopHiddenWorkerHost: DesktopHiddenWorkerHostPort = Object.freeze({
  registerHiddenWorker,
  unregisterHiddenWorker,
  ensureHiddenWorkerReady,
  touchHiddenWorker,
  invokeHiddenWorker,
  invalidateHiddenWorker,
});
