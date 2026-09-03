import type { HiddenWorkerDefinition } from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';

import type { BackendHiddenWorkerRuntimePort } from '../definitions/backendHiddenWorkerRuntimePort';
import type {
  DesktopHiddenWorkerDescriptor,
  DesktopHiddenWorkerHostPort,
  DesktopHiddenWorkerInvocation,
} from '../definitions/desktopHiddenWorkerHostPort';

/** Backend 保留插件 codec 和同步 registry；Desktop 只接收已经编码的 data-only envelope。 */
export function createBackendHiddenWorkerRuntime(
  desktopHost: DesktopHiddenWorkerHostPort,
): BackendHiddenWorkerRuntimePort {
  interface RegisteredDefinition {
    readonly workerId: string;
    readonly definition: HiddenWorkerDefinition;
  }
  const definitions = new Map<string, RegisteredDefinition>();

  const readDefinition = (workerId: string): RegisteredDefinition => {
    const normalized = normalizeWorkerId(workerId);
    const registered = definitions.get(normalized);
    if (!registered) {
      throw new Error(`未知 hidden worker: ${normalized}`);
    }
    return registered;
  };

  const ensureReady = async (registered: RegisteredDefinition): Promise<void> => {
    try {
      const payload = await desktopHost.ensureHiddenWorkerReady(registered.workerId);
      registered.definition.parseReadyPayload(payload);
    } catch (error) {
      desktopHost.invalidateHiddenWorker(registered.workerId, errorMessage(error));
      throw error;
    }
  };

  const runtime: BackendHiddenWorkerRuntimePort = {
    async registerHiddenWorker(definition, options = {}) {
      const workerId = normalizeWorkerId(definition.id);
      if (definitions.has(workerId) && options.replace !== true) {
        throw new Error(`Hidden worker 已注册: ${workerId}`);
      }
      await desktopHost.registerHiddenWorker(toDesktopDescriptor(definition, workerId), options);
      definitions.set(workerId, { workerId, definition });
    },

    async unregisterHiddenWorker(workerId) {
      const normalized = normalizeWorkerIdOrNull(workerId);
      if (!normalized || !definitions.has(normalized)) {
        return false;
      }
      const removed = await desktopHost.unregisterHiddenWorker(normalized);
      definitions.delete(normalized);
      return removed;
    },

    hasHiddenWorker(workerId) {
      const normalized = normalizeWorkerIdOrNull(workerId);
      return normalized ? definitions.has(normalized) : false;
    },

    listHiddenWorkerIds() {
      return [...definitions.keys()];
    },

    async ensureHiddenWorkerReady(workerId) {
      await ensureReady(readDefinition(workerId));
    },

    touchHiddenWorker(workerId) {
      desktopHost.touchHiddenWorker(readDefinition(workerId).workerId);
    },

    async invokeHiddenWorker(workerId, request, options) {
      const registered = readDefinition(workerId);
      const { definition } = registered;
      await ensureReady(registered);
      const envelope = definition.createRequestPayload(request);
      const invocation = toDesktopInvocation(definition, envelope.requestId, envelope.payload);
      const rawResponse = await desktopHost.invokeHiddenWorker(
        registered.workerId,
        invocation,
        options,
      );
      try {
        return definition.parseResponsePayload(rawResponse).response;
      } catch (error) {
        desktopHost.invalidateHiddenWorker(registered.workerId, errorMessage(error));
        throw error;
      }
    },
  };
  return Object.freeze(runtime);
}

function toDesktopDescriptor(
  definition: HiddenWorkerDefinition,
  workerId: string,
): DesktopHiddenWorkerDescriptor {
  return {
    id: workerId,
    requestChannel: definition.requestChannel,
    responseChannel: definition.responseChannel,
    readyChannel: definition.readyChannel,
    workerHtmlPath: definition.workerHtmlPath,
    preloadPath: definition.preloadPath,
    ...(definition.partition ? { partition: definition.partition } : {}),
    ...(definition.cancelChannel ? { cancelChannel: definition.cancelChannel } : {}),
    ...(definition.idleTimeoutMs == null ? {} : { idleTimeoutMs: definition.idleTimeoutMs }),
    ...(definition.readyTimeoutMs == null ? {} : { readyTimeoutMs: definition.readyTimeoutMs }),
    ...(definition.requestTimeoutMs == null ? {} : { requestTimeoutMs: definition.requestTimeoutMs }),
    ...(definition.maxConsecutiveTimeouts == null
      ? {}
      : { maxConsecutiveTimeouts: definition.maxConsecutiveTimeouts }),
  };
}

function toDesktopInvocation(
  definition: HiddenWorkerDefinition,
  requestId: string,
  payload: unknown,
): DesktopHiddenWorkerInvocation {
  return {
    requestId,
    payload,
    ...(definition.createCancelPayload
      ? { cancelPayload: definition.createCancelPayload(requestId) }
      : {}),
  };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
