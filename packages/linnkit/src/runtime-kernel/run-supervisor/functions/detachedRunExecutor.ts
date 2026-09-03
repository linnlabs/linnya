import { NotImplementedError } from '../runErrors';
import type { RunHandle, RunRequestSnapshot } from '../runHandle';
import type { RunRegistryStore } from '../runRegistryStorePort';
import type {
  RunExecutorPort,
  RunOutcome,
  RunRegistrationSpec,
  RunTerminalError,
} from '../definitions/runSupervisorContracts';
import { cloneRunMetadata, runRecordToTerminalOutcome } from './runRecordProjection';
import type { RunId } from '../../../contracts';

export interface DetachedRunExecutor<TRequest extends RunRequestSnapshot> {
  executeDetachedRun(
    handle: RunHandle<TRequest>,
    spec: RunRegistrationSpec<TRequest>
  ): Promise<RunOutcome>;
}

export interface DetachedRunExecutorOptions<TRequest extends RunRequestSnapshot> {
  executor?: RunExecutorPort<TRequest>;
  registryStore: RunRegistryStore;
  now: () => number;
  notifyTerminal: (outcome: RunOutcome) => void;
  cleanupRunResources: (runId: RunId) => void;
}

function errorToTerminalError(error: unknown): RunTerminalError {
  if (error instanceof Error) {
    return {
      errorCode: error.name === 'AbortError' ? 'RUN_CANCELLED' : 'RUN_FAILED',
      message: error.message,
      recoverable: false,
    };
  }
  return {
    errorCode: 'RUN_FAILED',
    message: String(error),
    recoverable: false,
  };
}

export function createDetachedRunExecutor<TRequest extends RunRequestSnapshot>(
  options: DetachedRunExecutorOptions<TRequest>
): DetachedRunExecutor<TRequest> {
  async function persistExecutorOutcome(
    handle: RunHandle<TRequest>,
    executorOutcome: RunOutcome | void
  ): Promise<RunOutcome> {
    if (!executorOutcome || executorOutcome.status === 'completed') {
      await handle.markCompleted({
        currentNode: executorOutcome?.currentNode,
        iterationsUsed: executorOutcome?.iterationsUsed,
      });
    } else if (executorOutcome.status === 'cancelled') {
      await handle.cancel(
        {
          reason: executorOutcome.error?.message ?? 'detached run cancelled',
          forceCleanup: true,
        },
        {
          currentNode: executorOutcome.currentNode,
          iterationsUsed: executorOutcome.iterationsUsed,
        }
      );
    } else {
      await handle.markFailed(
        executorOutcome.error ?? {
          errorCode: 'RUN_FAILED',
          message: 'detached run failed',
          recoverable: false,
        },
        {
          currentNode: executorOutcome.currentNode,
          iterationsUsed: executorOutcome.iterationsUsed,
        }
      );
    }

    const loadedRecord = await options.registryStore.load(handle.runId);
    const record =
      loadedRecord && executorOutcome?.metadata
        ? {
            ...loadedRecord,
            metadata: {
              ...(loadedRecord.metadata ?? {}),
              ...executorOutcome.metadata,
            },
          }
        : loadedRecord;
    if (record && executorOutcome?.metadata) {
      await options.registryStore.save(record);
    }
    const completedAt = executorOutcome?.completedAt ?? options.now();
    const fallbackMeta = record ? undefined : await handle.meta();
    const outcome = runRecordToTerminalOutcome(
      record ?? {
        runId: handle.runId,
        parentRunId: handle.parentRunId,
        conversationId: fallbackMeta?.conversationId ?? '',
        agentSpecId: fallbackMeta?.agentSpecId,
        status: executorOutcome?.status ?? 'completed',
        startedAt: fallbackMeta?.startedAt ?? completedAt,
        updatedAt: completedAt,
      },
      completedAt
    );
    const nextOutcome: RunOutcome = {
      ...outcome,
      metadata: {
        ...(outcome.metadata ?? {}),
        ...(executorOutcome?.metadata ?? {}),
      },
    };
    return nextOutcome;
  }

  async function executeDetachedRun(
    handle: RunHandle<TRequest>,
    spec: RunRegistrationSpec<TRequest>
  ): Promise<RunOutcome> {
    if (!options.executor) {
      throw new NotImplementedError('RunSupervisor.spawnDetached requires a RunExecutorPort');
    }

    try {
      await handle.markRunning({ currentNode: 'detached' });
      const registeredRecord = await options.registryStore.load(handle.runId);
      const executorOutcome = await options.executor.execute({
        runId: handle.runId,
        parentRunId: handle.parentRunId,
        conversationId: registeredRecord?.conversationId ?? spec.conversationId,
        agentSpec: await handle.spec(),
        request: await handle.request(),
        signal: handle.signal,
        eventBus: spec.eventBus,
        eventStore: spec.eventStore,
        costCollector: spec.costCollector,
        query: spec.query,
        contextFences: spec.contextFences,
        wakeSource: spec.wakeSource,
        ephemeral: spec.ephemeral,
        metadata: cloneRunMetadata(registeredRecord?.metadata ?? spec.metadata),
      });
      const outcome = await persistExecutorOutcome(handle, executorOutcome);
      options.notifyTerminal(outcome);
      options.cleanupRunResources(handle.runId);
      return outcome;
    } catch (error) {
      const terminalError = errorToTerminalError(error);
      if (terminalError.errorCode === 'RUN_CANCELLED' || handle.signal.aborted) {
        await handle.cancel({
          reason: terminalError.message || 'detached run aborted',
          forceCleanup: true,
        });
      } else {
        await handle.markFailed(terminalError);
      }
      const record = await options.registryStore.load(handle.runId);
      const outcome = runRecordToTerminalOutcome(
        record ?? {
          runId: handle.runId,
          parentRunId: handle.parentRunId,
          conversationId: spec.conversationId,
          agentSpecId: spec.agentSpec.id,
          status: terminalError.errorCode === 'RUN_CANCELLED' ? 'cancelled' : 'failed',
          startedAt: options.now(),
          updatedAt: options.now(),
          errorIfAny: terminalError,
        },
        options.now()
      );
      options.notifyTerminal(outcome);
      options.cleanupRunResources(handle.runId);
      return outcome;
    }
  }

  return { executeDetachedRun };
}
