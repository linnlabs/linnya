import { RunNotFoundError } from '../runErrors';
import type { RunRecord } from '../runRegistryStorePort';
import type { RunId } from '../../../contracts';
import type { RunOutcome, RunWaitForTerminalOptions } from '../definitions/runSupervisorContracts';
import { runRecordToTerminalOutcome } from './runRecordProjection';
import { isRunTerminalStatus } from './runLifecycleTransition';

type TerminalWaiter = {
  wake: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export interface TerminalWaiterRegistry {
  waitForTerminal(runId: RunId, opts?: RunWaitForTerminalOptions): Promise<RunOutcome>;
  notify(runId: RunId): void;
}

export interface TerminalWaiterRegistryOptions {
  loadRecord: (runId: RunId) => Promise<RunRecord | null>;
}

function toTerminalOutcome(record: RunRecord): RunOutcome {
  return runRecordToTerminalOutcome(record, record.updatedAt);
}

export function createTerminalWaiterRegistry(
  options: TerminalWaiterRegistryOptions
): TerminalWaiterRegistry {
  const terminalWaiters = new Map<RunId, Set<TerminalWaiter>>();

  function getTerminalWaiters(runId: RunId): Set<TerminalWaiter> {
    const waiters = terminalWaiters.get(runId);
    if (waiters) {
      return waiters;
    }
    const created = new Set<TerminalWaiter>();
    terminalWaiters.set(runId, created);
    return created;
  }

  function notify(runId: RunId): void {
    const waiters = terminalWaiters.get(runId);
    if (!waiters) {
      return;
    }
    for (const waiter of Array.from(waiters)) {
      waiter.wake();
    }
    terminalWaiters.delete(runId);
  }

  async function waitForTerminal(
    runId: RunId,
    opts: RunWaitForTerminalOptions = {}
  ): Promise<RunOutcome> {
    const waiters = getTerminalWaiters(runId);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let wakeWaiter = (): void => undefined;
    const notified = new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        waiter.reject(new Error(`waitForTerminal aborted for run ${runId}`));
      };
      const waiter: TerminalWaiter = {
        wake: () => {
          waiter.cleanup();
          resolve();
        },
        reject: error => {
          waiter.cleanup();
          reject(error);
        },
        cleanup: () => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            terminalWaiters.delete(runId);
          }
          if (timeout) {
            clearTimeout(timeout);
          }
          opts.signal?.removeEventListener('abort', onAbort);
        },
      };
      wakeWaiter = waiter.wake;

      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      if (opts.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          waiter.reject(new Error(`waitForTerminal timed out for run ${runId}`));
        }, opts.timeoutMs);
      }
      waiters.add(waiter);
    });
    // timeout / abort 可能早于异步 store read 返回；提前挂接 handler，避免产生未处理 rejection。
    void notified.catch(() => undefined);

    try {
      // 先注册 waiter 再读取 owner，避免终态写入发生在 load 与订阅之间而漏通知。
      const currentRecord = await options.loadRecord(runId);
      if (!currentRecord) {
        throw new RunNotFoundError(runId);
      }
      if (isRunTerminalStatus(currentRecord.status)) {
        wakeWaiter();
        return toTerminalOutcome(currentRecord);
      }

      await notified;
      const terminalRecord = await options.loadRecord(runId);
      if (!terminalRecord) {
        throw new RunNotFoundError(runId);
      }
      if (!isRunTerminalStatus(terminalRecord.status)) {
        throw new Error(`run ${runId} was notified before reaching terminal status`);
      }
      return toTerminalOutcome(terminalRecord);
    } catch (error) {
      wakeWaiter();
      throw error;
    }
  }

  return {
    waitForTerminal,
    notify,
  };
}
