import type { RunRecord, RunRegistryStore } from '../runRegistryStorePort';
import type { RunOutcome } from '../definitions/runSupervisorContracts';
import { runRecordToTerminalOutcome } from './runRecordProjection';

export interface RecoverRunsOnBootOptions {
  registryStore: RunRegistryStore;
  reason: string;
  now: () => number;
  notifyTerminal: (outcome: RunOutcome) => void;
}

export async function recoverRunsOnBoot(options: RecoverRunsOnBootOptions): Promise<RunOutcome[]> {
  const activeRecords: RunRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await options.registryStore.list({
      status: ['pending', 'running', 'awaiting_user', 'paused'],
      limit: 200,
      cursor,
    });
    activeRecords.push(...page.runs);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  const outcomes: RunOutcome[] = [];
  // 必须先读完所有页再改状态；否则基于 offset 的 cursor 会因前页记录退出 active 集合而跳项。
  for (const record of activeRecords) {
    const updatedAt = options.now();
    const nextRecord: RunRecord = {
      ...record,
      status: 'failed',
      updatedAt,
      errorIfAny: {
        errorCode: 'RUN_ABANDONED',
        message: options.reason,
        recoverable: true,
      },
      metadata: {
        ...(record.metadata ?? {}),
        recovery: {
          reason: options.reason,
          recoveredAt: updatedAt,
        },
      },
    };
    await options.registryStore.save(nextRecord);
    const outcome = runRecordToTerminalOutcome(nextRecord, updatedAt);
    options.notifyTerminal(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}
