import { getLogger } from 'src/shared/logger';
import type {
  ProviderModelSynchronizationDependencies,
  ProviderModelSynchronizationLifecycle,
} from '../definitions/providerModelSynchronizationLifecycle';

const logger = getLogger('ProviderModelSynchronization');

export function createProviderModelSynchronizationLifecycle(
  dependencies: ProviderModelSynchronizationDependencies,
): ProviderModelSynchronizationLifecycle {
  const executions = new Map<string, { controller: AbortController; settlement: Promise<void> }>();
  let started = false;
  let stopped = false;

  const synchronizeConnectedProviderModels = (connectionId: string): Promise<void> => {
    if (stopped) return Promise.reject(new Error('Provider model synchronization owner has stopped'));
    const existing = executions.get(connectionId);
    if (existing) return existing.settlement;

    const controller = new AbortController();
    const startedAt = Date.now();
    logger.info('provider_models.refresh.started', { connectionId });
    const settlement = Promise.resolve()
      .then(() => dependencies.synchronize(connectionId, controller.signal))
      .finally(() => {
        executions.delete(connectionId);
        if (!controller.signal.aborted) dependencies.publishModelsChanged();
        logger.info('provider_models.refresh.settled', {
          connectionId,
          cancelled: controller.signal.aborted,
          durationMs: Date.now() - startedAt,
        });
      });
    executions.set(connectionId, { controller, settlement });
    return settlement;
  };

  return {
    synchronizeConnectedProviderModels,
    start() {
      if (started || stopped) return;
      started = true;
      for (const connectionId of dependencies.startupConnectionIds) {
        void synchronizeConnectedProviderModels(connectionId).catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          logger.warn('provider_models.refresh.failed', {
            connectionId,
            failureType: error instanceof Error ? error.name : 'unknown',
          });
        });
      }
    },
    async cancelAndWait(connectionId) {
      const execution = executions.get(connectionId);
      if (!execution) return;
      execution.controller.abort();
      // 等待已开始的单模型 durable 写入收口，再删除或替换账号凭据。
      await Promise.allSettled([execution.settlement]);
    },
    async stop() {
      stopped = true;
      const active = [...executions.values()];
      for (const execution of active) execution.controller.abort();
      await Promise.allSettled(active.map(execution => execution.settlement));
    },
  };
}
