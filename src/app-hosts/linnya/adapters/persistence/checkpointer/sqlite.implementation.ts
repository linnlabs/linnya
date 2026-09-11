/**
 * @file src/app-hosts/linnya/adapters/persistence/checkpointer/sqlite.implementation.ts
 * @description Linnya 宿主侧 Checkpointer 的 SQLite 实现，落 workspace.sqlite 的 engine_checkpoints 表。
 *
 * 与 MemoryCheckpointer 的契约一致（详见 src/agent/runtime-kernel/graph-engine/checkpointer/__tests__/memoryCheckpointer.contract.test.ts）。
 *
 * 设计要点：
 * - load/clear: 直接按 legacy conversation_id 主键操作；port 语义上它是 checkpointKey
 * - save: UPSERT，同时把 summarizeCheckpoint() 衍生的元数据冗余写出，避免 peekMeta/list 反序列化整个 state_json
 * - peekMeta/list: 仅读元数据列，不解析 state_json
 * - purgeStale: 宿主层 GC（不在 Checkpointer port 接口上），按 saved_at 老化清理，
 *   默认保留有 pending tool call 的行（可能是真的卡住等用户重启恢复的 case）
 */

import type Database from 'better-sqlite3';

import { graph } from '@linnlabs/linnkit/runtime-kernel';

type EngineState = graph.EngineState;
type Checkpointer = graph.Checkpointer;
type CheckpointListFilter = graph.CheckpointListFilter;
type CheckpointMeta = graph.CheckpointMeta;
type CheckpointSummary = graph.CheckpointSummary;

interface CheckpointMetaRow {
  conversation_id: string;
  schema_version: number;
  saved_at: number;
  current_node: string | null;
  iterations: number | null;
  has_pending_tool_calls: number;
}

interface CheckpointStateRow {
  state_json: string;
}

const META_COLUMNS = `
  conversation_id,
  schema_version,
  saved_at,
  current_node,
  iterations,
  has_pending_tool_calls
`;

export class SqliteCheckpointer implements Checkpointer {
  constructor(private readonly db: Database.Database) {}

  async load(checkpointKey: string): Promise<EngineState | null> {
    const row = this.db
      .prepare<
        [string],
        CheckpointStateRow
      >('SELECT state_json FROM engine_checkpoints WHERE conversation_id = ?')
      .get(checkpointKey);

    if (!row) {
      return null;
    }

    return graph.parseEngineCheckpoint(JSON.parse(row.state_json));
  }

  async save(checkpointKey: string, state: EngineState): Promise<void> {
    this.saveInTransaction(checkpointKey, state);
  }

  /** 同步写入供 Host 原子提交复用；不能在 better-sqlite3 事务中 await 异步 port。 */
  saveInTransaction(checkpointKey: string, state: EngineState): void {
    const savedAt = Date.now();
    const summary = graph.summarizeCheckpoint(checkpointKey, state, savedAt);
    const stateJson = JSON.stringify({
      ...state,
      schemaVersion: state.schemaVersion ?? graph.ENGINE_STATE_SCHEMA_VERSION,
    });

    this.db
      .prepare(
        `
        INSERT INTO engine_checkpoints (
          conversation_id,
          state_json,
          schema_version,
          saved_at,
          current_node,
          iterations,
          has_pending_tool_calls
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          state_json             = excluded.state_json,
          schema_version         = excluded.schema_version,
          saved_at               = excluded.saved_at,
          current_node           = excluded.current_node,
          iterations             = excluded.iterations,
          has_pending_tool_calls = excluded.has_pending_tool_calls
        `
      )
      .run(
        checkpointKey,
        stateJson,
        summary.schemaVersion,
        summary.savedAt,
        summary.currentNode ?? null,
        summary.iterations ?? null,
        summary.hasPendingToolCalls ? 1 : 0
      );
  }

  async clear(checkpointKey: string): Promise<void> {
    this.db.prepare('DELETE FROM engine_checkpoints WHERE conversation_id = ?').run(checkpointKey);
  }

  async peekMeta(checkpointKey: string): Promise<CheckpointMeta | null> {
    const row = this.db
      .prepare<
        [string],
        CheckpointMetaRow
      >(`SELECT ${META_COLUMNS} FROM engine_checkpoints WHERE conversation_id = ?`)
      .get(checkpointKey);

    return row ? this.rowToMeta(row) : null;
  }

  async list(filter: CheckpointListFilter = {}): Promise<CheckpointSummary[]> {
    const where: string[] = [];
    const params: (number | string)[] = [];

    if (filter.savedAfter !== undefined) {
      where.push('saved_at > ?');
      params.push(filter.savedAfter);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limitClause = filter.limit !== undefined ? 'LIMIT ?' : '';
    if (filter.limit !== undefined) {
      params.push(filter.limit);
    }

    const rows = this.db
      .prepare<
        typeof params,
        CheckpointMetaRow
      >(`SELECT ${META_COLUMNS} FROM engine_checkpoints ${whereClause} ORDER BY saved_at DESC ${limitClause}`)
      .all(...params);

    return rows.map(row => this.rowToMeta(row));
  }

  private rowToMeta(row: CheckpointMetaRow): CheckpointMeta {
    return {
      checkpointKey: row.conversation_id,
      schemaVersion: row.schema_version,
      savedAt: row.saved_at,
      currentNode: row.current_node ?? undefined,
      iterations: row.iterations ?? undefined,
      hasPendingToolCalls: row.has_pending_tool_calls === 1,
    };
  }

  /**
   * 宿主层 GC：清理过期的 EngineState checkpoint。
   *
   * 不在 Checkpointer port 接口上——平台层不该规定 GC 策略，留给宿主自定义。
   *
   * 默认行为：
   * - 删除 saved_at 早于 (now - olderThanMs) 的行
   * - 默认保留 has_pending_tool_calls=1 的行（可能是真卡住等用户恢复的 case）
   *   可通过 includePending=true 强制清理
   *
   * @returns 实际删除的行数
   */
  purgeStale(opts: {
    olderThanMs: number;
    includePending?: boolean;
    now?: number;
    protectedCheckpointKeys?: readonly string[];
  }): number {
    const now = opts.now ?? Date.now();
    const cutoff = now - opts.olderThanMs;
    const includePending = opts.includePending === true;

    let sql = includePending
      ? 'DELETE FROM engine_checkpoints WHERE saved_at < ?'
      : 'DELETE FROM engine_checkpoints WHERE saved_at < ? AND has_pending_tool_calls = 0';

    const protectedKeys = opts.protectedCheckpointKeys ?? [];
    if (protectedKeys.length > 0) {
      sql += ` AND conversation_id NOT IN (${protectedKeys.map(() => '?').join(',')})`;
    }
    const result = this.db.prepare(sql).run(cutoff, ...protectedKeys);
    return Number(result.changes);
  }
}
