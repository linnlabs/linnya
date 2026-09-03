import type {
  ListRunsFilter,
  RunRecord,
  RunRegistryStore,
  RunStatus,
} from './runRegistryStorePort';
import type { RunId } from '../../contracts';

function cloneRunRecord(record: RunRecord): RunRecord {
  return {
    ...record,
    iterationBudget: record.iterationBudget ? { ...record.iterationBudget } : undefined,
    errorIfAny: record.errorIfAny ? { ...record.errorIfAny } : undefined,
    metadata: record.metadata ? structuredClone(record.metadata) : undefined,
  };
}

function matchesStatus(candidate: RunStatus, filter: ListRunsFilter['status']): boolean {
  if (filter === undefined) {
    return true;
  }
  if (Array.isArray(filter)) {
    return filter.includes(candidate);
  }
  return candidate === filter;
}

export class MemoryRunRegistryStore implements RunRegistryStore {
  private readonly store = new Map<RunId, RunRecord>();

  async save(record: RunRecord): Promise<void> {
    this.store.set(record.runId, cloneRunRecord(record));
  }

  async load(runId: RunId): Promise<RunRecord | null> {
    const record = this.store.get(runId);
    return record ? cloneRunRecord(record) : null;
  }

  async list(filter: ListRunsFilter = {}): Promise<{ runs: RunRecord[]; nextCursor?: string }> {
    const sorted = Array.from(this.store.values())
      .filter(record =>
        filter.conversationId === undefined
          ? true
          : record.conversationId === filter.conversationId
      )
      .filter(record => matchesStatus(record.status, filter.status))
      .filter(record =>
        filter.parentRunId === undefined ? true : record.parentRunId === filter.parentRunId
      )
      .filter(record =>
        filter.agentSpecId === undefined ? true : record.agentSpecId === filter.agentSpecId
      )
      .filter(record =>
        filter.startedAfter === undefined ? true : record.startedAt > filter.startedAfter
      )
      .filter(record =>
        filter.startedBefore === undefined ? true : record.startedAt < filter.startedBefore
      )
      .sort((left, right) => right.startedAt - left.startedAt || right.updatedAt - left.updatedAt);

    const offset = filter.cursor ? Number.parseInt(filter.cursor, 10) : 0;
    const page =
      filter.limit === undefined
        ? sorted.slice(offset)
        : sorted.slice(offset, offset + filter.limit);
    const nextOffset = filter.limit === undefined ? undefined : offset + page.length;
    const nextCursor =
      nextOffset !== undefined && nextOffset < sorted.length ? String(nextOffset) : undefined;

    return {
      runs: page.map(cloneRunRecord),
      nextCursor,
    };
  }

  async delete(runId: RunId): Promise<void> {
    this.store.delete(runId);
  }
}
