import type Database from 'better-sqlite3';

import {
  ACTION_LEDGER_MAX_QUERY_LIMIT,
  type ActionActor,
  type ActionActorKind,
  type ActionLedgerAction,
  type ActionLedgerChangeList,
  type ActionLedgerChangeQuery,
  type ActionLedgerDocumentChange,
  type ActionLedgerEntryInput,
  type ActionLedgerGranularity,
  type ActionLedgerRecorder,
} from '../../definitions/actionLedger';

const ACTIONS: readonly ActionLedgerAction[] = ['create', 'update'];
const ACTOR_KINDS: readonly ActionActorKind[] = ['user', 'run', 'subrun', 'plugin', 'external'];
const GRANULARITIES: readonly ActionLedgerGranularity[] = ['coarse', 'fine'];

export interface SqliteActionLedger {
  /** 为一个入口绑定执行者；返回的端口不接受身份字段。 */
  recorderFor(actor: ActionActor, granularity: ActionLedgerGranularity): ActionLedgerRecorder;
  listDocumentChanges(query: ActionLedgerChangeQuery): ActionLedgerChangeList;
}

interface ChangeRow {
  readonly document_id: string;
  readonly document_type: string;
  readonly actor_kind: string;
  readonly actor_plugin_id: string | null;
  readonly run_id: string | null;
  readonly root_run_id: string | null;
  readonly parent_run_id: string | null;
  readonly conversation_id: string | null;
  readonly actions: string;
  readonly entry_count: number;
  readonly min_granularity: string;
  readonly max_granularity: string;
  readonly first_recorded_at: number;
  readonly last_recorded_at: number;
}

export function createSqliteActionLedger(
  db: Database.Database,
  options: { readonly now?: () => number } = {}
): SqliteActionLedger {
  const now = options.now ?? Date.now;
  const insert = db.prepare(`
    INSERT INTO action_ledger_entries (
      recorded_at, project_id, document_id, document_type, action, granularity,
      part, before_ref, after_ref, summary_json,
      actor_kind, actor_plugin_id, author_run_id,
      conversation_id, run_id, root_run_id, parent_run_id, tool_call_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const hasFineEntryForCall = db.prepare(`
    SELECT 1 FROM action_ledger_entries
    WHERE root_run_id = ? AND run_id = ? AND tool_call_id = ? AND document_id = ? AND granularity = 'fine'
    LIMIT 1
  `);

  return {
    recorderFor(actor, granularity) {
      assertOneOf(granularity, GRANULARITIES, 'granularity');
      const run = actor.kind === 'run' || actor.kind === 'subrun' ? actor : null;
      return {
        record(entry: ActionLedgerEntryInput): void {
          assertOneOf(entry.action, ACTIONS, 'action');
          // owner 细账在自己的事务里先写；同一调用同一文档已有细账时，Host 粗账不再重复。
          if (
            granularity === 'coarse' && run?.toolCallId &&
            hasFineEntryForCall.get(run.rootRunId, run.runId, run.toolCallId, entry.documentId)
          ) {
            return;
          }
          insert.run(
            now(),
            entry.projectId,
            entry.documentId,
            entry.documentType,
            entry.action,
            granularity,
            entry.part ?? null,
            entry.beforeRef ?? null,
            entry.afterRef ?? null,
            entry.summary ? JSON.stringify(entry.summary) : null,
            actor.kind,
            actor.kind === 'plugin' ? actor.pluginId : null,
            entry.authorRunId ?? null,
            run?.conversationId ?? null,
            run?.runId ?? null,
            run?.rootRunId ?? null,
            run?.parentRunId ?? null,
            run?.toolCallId ?? null
          );
        },
      };
    },

    listDocumentChanges(query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > ACTION_LEDGER_MAX_QUERY_LIMIT) {
        throw new RangeError(`limit 须为 1–${ACTION_LEDGER_MAX_QUERY_LIMIT} 的整数`);
      }
      const where = ['project_id = ?'];
      const args: (string | number)[] = [query.projectId];
      if (query.rootRunId !== undefined) {
        where.push('root_run_id = ?');
        args.push(query.rootRunId);
      }
      if (query.since !== undefined) {
        where.push('recorded_at >= ?');
        args.push(query.since);
      }
      if (query.until !== undefined) {
        where.push('recorded_at < ?');
        args.push(query.until);
      }
      const rows = db.prepare(`
        SELECT document_id, MIN(document_type) AS document_type, actor_kind, actor_plugin_id, run_id,
          MIN(root_run_id) AS root_run_id, MIN(parent_run_id) AS parent_run_id, MIN(conversation_id) AS conversation_id,
          GROUP_CONCAT(DISTINCT action) AS actions, COUNT(*) AS entry_count,
          MIN(granularity) AS min_granularity, MAX(granularity) AS max_granularity,
          MIN(recorded_at) AS first_recorded_at, MAX(recorded_at) AS last_recorded_at
        FROM action_ledger_entries
        WHERE ${where.join(' AND ')}
        GROUP BY document_id, actor_kind, actor_plugin_id, run_id
        ORDER BY last_recorded_at DESC, document_id, run_id
        LIMIT ?
      `).all(...args, query.limit + 1) as ChangeRow[];
      return {
        changes: rows.slice(0, query.limit).map(toDocumentChange),
        truncated: rows.length > query.limit,
      };
    },
  };
}

function toDocumentChange(row: ChangeRow): ActionLedgerDocumentChange {
  const minGranularity = assertOneOf(row.min_granularity, GRANULARITIES, 'granularity');
  const maxGranularity = assertOneOf(row.max_granularity, GRANULARITIES, 'granularity');
  return {
    documentId: row.document_id,
    documentType: row.document_type,
    actorKind: assertOneOf(row.actor_kind, ACTOR_KINDS, 'actor_kind'),
    pluginId: row.actor_plugin_id,
    runId: row.run_id,
    rootRunId: row.root_run_id,
    parentRunId: row.parent_run_id,
    conversationId: row.conversation_id,
    actions: row.actions.split(',').map(action => assertOneOf(action, ACTIONS, 'action')),
    entryCount: row.entry_count,
    granularity: minGranularity === maxGranularity ? minGranularity : 'mixed',
    firstRecordedAt: row.first_recorded_at,
    lastRecordedAt: row.last_recorded_at,
  };
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  const match = allowed.find(candidate => candidate === value);
  if (match === undefined) throw new Error(`行动账本 ${field} 不在合同范围内：${value}`);
  return match;
}
