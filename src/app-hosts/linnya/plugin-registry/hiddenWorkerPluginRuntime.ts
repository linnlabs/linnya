import type { PluginId } from '@app/schemas';
import { getBackendHiddenWorkerRuntimePort } from '../desktop-capabilities';
import { pluginDiagnostics } from './diagnostics';
import type { BackendPluginHiddenWorkerRegistration } from './registry';

interface ManagedHiddenWorker {
  readonly pluginId: PluginId;
}

const managedWorkers = new Map<string, ManagedHiddenWorker>();

export async function syncBackendPluginHiddenWorkers(
  registrations: readonly BackendPluginHiddenWorkerRegistration[],
): Promise<void> {
  const hiddenWorkerRuntime = getBackendHiddenWorkerRuntimePort();
  const desired = buildDesiredWorkerMap(registrations);

  for (const [workerId] of managedWorkers) {
    if (!desired.has(workerId)) {
      await hiddenWorkerRuntime.unregisterHiddenWorker(workerId);
      managedWorkers.delete(workerId);
    }
  }

  for (const [workerId, registration] of desired) {
    const managed = managedWorkers.get(workerId);
    if (managed) {
      if (managed.pluginId !== registration.pluginId) {
        const message = `hidden worker id 已由其他插件托管: ${workerId} (${managed.pluginId}, ${registration.pluginId})`;
        recordHiddenWorkerError(registration.pluginId, message);
        throw new Error(`[plugin-registry] ${message}`);
      }
      continue;
    }

    if (hiddenWorkerRuntime.hasHiddenWorker(workerId)) {
      const message = `hidden worker 已被非插件运行态注册，拒绝覆盖: ${workerId}`;
      recordHiddenWorkerError(registration.pluginId, message);
      throw new Error(`[plugin-registry] ${message}`);
    }

    await hiddenWorkerRuntime.registerHiddenWorker(registration.worker);
    managedWorkers.set(workerId, { pluginId: registration.pluginId });
  }
}

export async function clearSyncedBackendPluginHiddenWorkersForTests(): Promise<void> {
  const hiddenWorkerRuntime = getBackendHiddenWorkerRuntimePort();
  for (const workerId of managedWorkers.keys()) {
    await hiddenWorkerRuntime.unregisterHiddenWorker(workerId);
  }
  managedWorkers.clear();
}

function buildDesiredWorkerMap(
  registrations: readonly BackendPluginHiddenWorkerRegistration[],
): Map<string, BackendPluginHiddenWorkerRegistration> {
  const desired = new Map<string, BackendPluginHiddenWorkerRegistration>();
  for (const registration of registrations) {
    const workerId = normalizeWorkerId(registration.worker.id, registration.pluginId);
    const existing = desired.get(workerId);
    if (existing) {
      const message = `hidden worker id 冲突: ${workerId} (${existing.pluginId}, ${registration.pluginId})`;
      recordHiddenWorkerError(registration.pluginId, message);
      throw new Error(`[plugin-registry] ${message}`);
    }
    desired.set(workerId, registration);
  }
  return desired;
}

function normalizeWorkerId(workerId: string, pluginId: PluginId): string {
  const normalized = workerId.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  const message = `插件声明了空 hidden worker id: ${pluginId}`;
  recordHiddenWorkerError(pluginId, message);
  throw new Error(`[plugin-registry] ${message}`);
}

function recordHiddenWorkerError(pluginId: PluginId, message: string): void {
  pluginDiagnostics.record({
    level: 'error',
    pluginId,
    capability: 'hiddenWorker',
    message,
  });
}
