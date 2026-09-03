import type { RunMeta } from '../runHandle';
import type { RunRecord } from '../runRegistryStorePort';
import type { RunOutcome, RunSnapshot } from '../definitions/runSupervisorContracts';
import { isRunTerminalStatus } from './runLifecycleTransition';

export function cloneRunMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return metadata ? structuredClone(metadata) : undefined;
}

export function runRecordToMeta(record: RunRecord): RunMeta {
  return {
    runId: record.runId,
    parentRunId: record.parentRunId,
    agentSpecId: record.agentSpecId,
    conversationId: record.conversationId,
    status: record.status,
    currentNode: record.currentNode,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    pausedAt: record.pausedAt,
    pauseReason: record.pauseReason,
    iterationsUsed: record.iterationsUsed,
    errorIfAny: record.errorIfAny ? { ...record.errorIfAny } : undefined,
  };
}

export function runRecordToSnapshot(record: RunRecord): RunSnapshot {
  return {
    ...runRecordToMeta(record),
    metadata: cloneRunMetadata(record.metadata),
  };
}

export function runRecordToTerminalOutcome(
  record: RunRecord,
  completedAt: number,
): RunOutcome {
  return {
    runId: record.runId,
    status: isRunTerminalStatus(record.status) ? record.status : 'failed',
    completedAt,
    currentNode: record.currentNode,
    iterationsUsed: record.iterationsUsed,
    error: record.errorIfAny ? { ...record.errorIfAny } : undefined,
    metadata: cloneRunMetadata(record.metadata),
  };
}
