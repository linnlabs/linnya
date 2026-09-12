import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { CONVERSATION_RUN_KIND } from '../definitions/conversationRunKind';

type ListRunsFilter = runSupervisor.ListRunsFilter;
type RunRecord = runSupervisor.RunRecord;
type RunRegistryStore = runSupervisor.RunRegistryStore;
type RunStatus = runSupervisor.RunStatus;

interface RunRow {
  id: string;
  conversation_id: string;
  parent_run_id: string | null;
  agent_spec_id: string | null;
  status: string;
  current_node: string | null;
  start_ts: number;
  updated_ts: number | null;
  paused_ts: number | null;
  pause_reason: string | null;
  iterations_used: number | null;
  iteration_budget_json: string | null;
  error_json: string | null;
  metadata_json: string | null;
}

interface ExistingRunOwnerRow {
  conversation_id: string;
}

interface RunFactsRow {
  source: string;
}

function isRunStatus(value: string): value is RunStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'awaiting_user' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function parseRecordJson(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function parseIterationBudget(value: string | null): RunRecord['iterationBudget'] {
  const parsed = parseRecordJson(value);
  if (!parsed) return undefined;
  const max = parsed.max;
  const refundable = parsed.refundable;
  if (typeof max !== 'number' || typeof refundable !== 'boolean') {
    return undefined;
  }
  return { max, refundable };
}

function parseError(value: string | null): RunRecord['errorIfAny'] {
  const parsed = parseRecordJson(value);
  if (!parsed) return undefined;
  const errorCode = parsed.errorCode;
  const message = parsed.message;
  const recoverable = parsed.recoverable;
  if (
    typeof errorCode !== 'string' ||
    typeof message !== 'string' ||
    typeof recoverable !== 'boolean'
  ) {
    return undefined;
  }
  return { errorCode, message, recoverable };
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function resolveEndTs(record: RunRecord): number | null {
  return record.status === 'completed' ||
    record.status === 'failed' ||
    record.status === 'cancelled'
    ? record.updatedAt
    : null;
}

function mapRowToRunRecord(row: RunRow): RunRecord {
  if (!isRunStatus(row.status)) {
    throw new Error(
      `[SQLiteRunRegistryStore] Unknown run status "${row.status}" for run ${row.id}`
    );
  }

  return {
    runId: RunIdSchema.parse(row.id),
    conversationId: row.conversation_id,
    parentRunId: row.parent_run_id === null ? undefined : RunIdSchema.parse(row.parent_run_id),
    agentSpecId: row.agent_spec_id ?? undefined,
    status: row.status,
    currentNode: row.current_node ?? undefined,
    startedAt: row.start_ts,
    updatedAt: row.updated_ts ?? row.start_ts,
    pausedAt: row.paused_ts ?? undefined,
    pauseReason: row.pause_reason ?? undefined,
    iterationsUsed: row.iterations_used ?? undefined,
    iterationBudget: parseIterationBudget(row.iteration_budget_json),
    errorIfAny: parseError(row.error_json),
    metadata: parseRecordJson(row.metadata_json),
  };
}

function matchesStatus(candidate: RunStatus, filter: ListRunsFilter['status']): boolean {
  if (filter === undefined) return true;
  return Array.isArray(filter) ? filter.includes(candidate) : candidate === filter;
}

export class SQLiteRunRegistryStore implements RunRegistryStore {
  constructor(private readonly db: Database.Database) {}

  async save(record: RunRecord): Promise<void> {
    this.saveInTransaction(record);
  }

  async compareAndSwap(previous: RunRecord, next: RunRecord): Promise<boolean> {
    return this.compareAndSwapInTransaction(previous, next);
  }

  compareAndSwapInTransaction(previous: RunRecord, next: RunRecord): boolean {
    return this.db.transaction(() => {
      // SQLite JSON 不保存 undefined；比较持久形态，不能把省略可选字段误判成并发写入。
      const current: unknown = JSON.parse(JSON.stringify(this.loadRecord(previous.runId)));
      const expected: unknown = JSON.parse(JSON.stringify(previous));
      if (previous.runId !== next.runId || !isDeepStrictEqual(current, expected)) return false;
      this.saveInTransaction(next);
      return true;
    })();
  }

  /** 同一 SQLite 提交事务内校验 activation；暂停收口期间仍允许原执行保存安全边界。 */
  requireExecutionOwner(runId: string, executionId: string): RunRecord {
    const record = this.loadRecord(runId);
    const canCommit =
      record?.status === 'running' ||
      (record?.status === 'paused' && record.pausedAt === undefined);
    if (!record || !canCommit || record.metadata?.executionId !== executionId) {
      throw new Error(
        `[SQLiteRunRegistryStore] execution ${executionId} no longer owns run ${runId}`
      );
    }
    return record;
  }

  /** 取消后由 execution-commit 核验原执行的收尾链；工具效果写入仍走严格 owner 检查。 */
  requireCheckpointExecutionOwner(runId: string, executionId: string): RunRecord {
    const record = this.loadRecord(runId);
    if (record?.status === 'cancelled' && record.metadata?.executionId === executionId) {
      return record;
    }
    return this.requireExecutionOwner(runId, executionId);
  }

  saveInTransaction(record: RunRecord): void {
    const existingOwner = this.db
      .prepare(
        `
      SELECT conversation_id
      FROM runs
      WHERE id = ?
      LIMIT 1
    `
      )
      .get(record.runId) as ExistingRunOwnerRow | undefined;

    if (existingOwner && existingOwner.conversation_id !== record.conversationId) {
      throw new Error(
        `[SQLiteRunRegistryStore] run ${record.runId} belongs to conversation ${existingOwner.conversation_id}, cannot save it for ${record.conversationId}`
      );
    }

    this.db
      .prepare(
        `
      INSERT INTO runs (
        id,
        conversation_id,
        kind,
        status,
        parent_run_id,
        agent_spec_id,
        current_node,
        start_ts,
        updated_ts,
        end_ts,
        paused_ts,
        pause_reason,
        iterations_used,
        iteration_budget_json,
        error_json,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        parent_run_id = excluded.parent_run_id,
        agent_spec_id = excluded.agent_spec_id,
        current_node = excluded.current_node,
        updated_ts = excluded.updated_ts,
        end_ts = excluded.end_ts,
        paused_ts = excluded.paused_ts,
        pause_reason = excluded.pause_reason,
        iterations_used = excluded.iterations_used,
        iteration_budget_json = excluded.iteration_budget_json,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `
      )
      .run(
        record.runId,
        record.conversationId,
        CONVERSATION_RUN_KIND.AGENT,
        record.status,
        record.parentRunId ?? null,
        record.agentSpecId ?? null,
        record.currentNode ?? null,
        record.startedAt,
        record.updatedAt,
        resolveEndTs(record),
        record.pausedAt ?? null,
        record.pauseReason ?? null,
        record.iterationsUsed ?? null,
        toJson(record.iterationBudget),
        toJson(record.errorIfAny),
        toJson(record.metadata)
      );
  }

  async load(runId: string): Promise<RunRecord | null> {
    return this.loadRecord(runId);
  }

  private loadRecord(runId: string): RunRecord | null {
    const row = this.db
      .prepare(
        `
      SELECT
        id,
        conversation_id,
        parent_run_id,
        agent_spec_id,
        status,
        current_node,
        start_ts,
        updated_ts,
        paused_ts,
        pause_reason,
        iterations_used,
        iteration_budget_json,
        error_json,
        metadata_json
      FROM runs
      WHERE id = ?
      LIMIT 1
    `
      )
      .get(runId) as RunRow | undefined;

    return row ? mapRowToRunRecord(row) : null;
  }

  async list(filter: ListRunsFilter = {}): Promise<{ runs: RunRecord[]; nextCursor?: string }> {
    const predicates: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.conversationId !== undefined) {
      predicates.push('conversation_id = ?');
      parameters.push(filter.conversationId);
    }
    if (filter.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      predicates.push(
        statuses.length === 0 ? '0 = 1' : `status IN (${statuses.map(() => '?').join(', ')})`
      );
      parameters.push(...statuses);
    }
    const whereClause = predicates.length === 0 ? '' : `WHERE ${predicates.join(' AND ')}`;
    const statement = this.db.prepare(
      `
      SELECT
        id,
        conversation_id,
        parent_run_id,
        agent_spec_id,
        status,
        current_node,
        start_ts,
        updated_ts,
        paused_ts,
        pause_reason,
        iterations_used,
        iteration_budget_json,
        error_json,
        metadata_json
      FROM runs
      ${whereClause}
      ORDER BY start_ts DESC, COALESCE(updated_ts, start_ts) DESC, id DESC
    `
    );
    // predicate 只由固定字段与占位符组成；按 conversation/status 查询不会先物化全表。
    const rows = statement.all(...parameters) as RunRow[];

    const filtered = rows
      .map(mapRowToRunRecord)
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
      );

    const offset = filter.cursor ? Number.parseInt(filter.cursor, 10) : 0;
    const page =
      filter.limit === undefined
        ? filtered.slice(offset)
        : filtered.slice(offset, offset + filter.limit);
    const nextOffset = filter.limit === undefined ? undefined : offset + page.length;
    const nextCursor =
      nextOffset !== undefined && nextOffset < filtered.length ? String(nextOffset) : undefined;

    return { runs: page, nextCursor };
  }

  async delete(runId: string): Promise<void> {
    const fact = this.db
      .prepare(
        `
      SELECT 'events' AS source FROM events WHERE run_id = ?
      UNION ALL
      SELECT 'ui_projection' AS source FROM conversation_ui_messages WHERE run_id = ?
      LIMIT 1
    `
      )
      .get(runId, runId) as RunFactsRow | undefined;
    if (fact) {
      throw new Error(
        `[SQLiteRunRegistryStore] run ${runId} owns ${fact.source} facts; delete it through the EventStore history workflow`
      );
    }
    this.db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
  }
}
