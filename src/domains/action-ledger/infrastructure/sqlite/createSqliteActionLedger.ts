import type Database from 'better-sqlite3';

import {
  ACTION_LEDGER_MAX_QUERY_LIMIT,
  type ActionActor,
  type ActionActorKind,
  type ActionLedgerAction,
  type ActionLedgerChangeList,
  type ActionLedgerChangeQuery,
  type ActionLedgerDocumentChange,
  type ActionLedgerDocumentSummary,
  type ActionLedgerEntryInput,
  type ActionLedgerGranularity,
  type ActionLedgerRecorder,
} from '../../definitions/actionLedger';

import { pruneDocumentActions } from './pruneDocumentActions';

const ACTIONS: readonly ActionLedgerAction[] = ['create', 'update', 'tag', 'untag', 'set_props'];
const ACTOR_KINDS: readonly ActionActorKind[] = ['user', 'run', 'subrun', 'plugin', 'external'];
const GRANULARITIES: readonly ActionLedgerGranularity[] = ['coarse', 'fine'];

export interface SqliteActionLedger {
  /** 为一个入口绑定执行者；返回的端口不接受身份字段。 */
  recorderFor(actor: ActionActor, granularity: ActionLedgerGranularity): ActionLedgerRecorder;
  listDocumentChanges(query: ActionLedgerChangeQuery): ActionLedgerChangeList;
  /**
   * 当前项目里每份有账的文档各一项：最早一条若是新建则给出新建者，另给最近一条。
   * 给了 `documentIds` 时只看这些文档。没有上限：每份文档一项，规模随项目文档数。
   */
  summarizeProjectDocuments(projectId: string, documentIds?: readonly string[]): ActionLedgerDocumentSummary[];
  /** 每个对话在这个项目里改过多少份文档（去重）。只数发生在本项目的记录，文档仍在本项目。 */
  countDocumentsByConversation(projectId: string): ReadonlyMap<string, number>;
}

interface SummaryRow {
  readonly document_id: string;
  readonly first_action: string;
  readonly first_actor_kind: string;
  readonly first_plugin_id: string | null;
  readonly first_conversation_id: string | null;
  readonly first_agent_id: string | null;
  readonly last_actor_kind: string;
  readonly last_plugin_id: string | null;
  readonly last_agent_id: string | null;
  readonly last_recorded_at: number;
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
  readonly agent_id: string | null;
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
      conversation_id, run_id, root_run_id, parent_run_id, tool_call_id, agent_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const readRunAgentId = createRunAgentIdReader(db);
  const hasFineEntryForCall = db.prepare(`
    SELECT 1 FROM action_ledger_entries
    WHERE root_run_id = ? AND run_id = ? AND tool_call_id = ? AND document_id = ? AND granularity = 'fine'
    LIMIT 1
  `);

  return {
    recorderFor(actor, granularity) {
      assertOneOf(granularity, GRANULARITIES, 'granularity');
      const run = actor.kind === 'run' || actor.kind === 'subrun'
        ? actor
        : actor.kind === 'external' ? actor.run ?? null : null;
      const record = db.transaction((entry: ActionLedgerEntryInput): void => {
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
          run?.toolCallId ?? null,
          run ? readRunAgentId(run.runId) : null
        );
        pruneDocumentActions(db, entry.documentId);
      });
      return { record: record.immediate };
    },

    listDocumentChanges(query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > ACTION_LEDGER_MAX_QUERY_LIMIT) {
        throw new RangeError(`limit 须为 1–${ACTION_LEDGER_MAX_QUERY_LIMIT} 的整数`);
      }
      const where = ['node.project_id = ?'];
      const args: (string | number)[] = [query.projectId];
      if (query.rootRunId !== undefined) {
        where.push('entry.project_id = node.project_id AND entry.root_run_id = ?');
        args.push(query.rootRunId);
      }
      if (query.conversationId !== undefined) {
        where.push('entry.project_id = node.project_id AND entry.conversation_id = ?');
        args.push(query.conversationId);
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
        WITH visible AS (
          SELECT entry.document_id, entry.document_type, entry.actor_kind, entry.action, entry.granularity, entry.recorded_at,
            CASE WHEN entry.project_id = node.project_id THEN entry.actor_plugin_id END AS actor_plugin_id,
            CASE WHEN entry.project_id = node.project_id THEN entry.run_id END AS run_id,
            CASE WHEN entry.project_id = node.project_id THEN entry.root_run_id END AS root_run_id,
            CASE WHEN entry.project_id = node.project_id THEN entry.parent_run_id END AS parent_run_id,
            CASE WHEN entry.project_id = node.project_id THEN entry.conversation_id END AS conversation_id,
            entry.agent_id
          FROM workspace_nodes node JOIN action_ledger_entries entry ON entry.document_id = node.id
          WHERE ${where.join(' AND ')}
        )
        SELECT document_id, MIN(document_type) AS document_type, actor_kind, actor_plugin_id, run_id,
          MIN(root_run_id) AS root_run_id, MIN(parent_run_id) AS parent_run_id, MIN(conversation_id) AS conversation_id,
          MIN(agent_id) AS agent_id,
          GROUP_CONCAT(DISTINCT action) AS actions, COUNT(*) AS entry_count,
          MIN(granularity) AS min_granularity, MAX(granularity) AS max_granularity,
          MIN(recorded_at) AS first_recorded_at, MAX(recorded_at) AS last_recorded_at
        FROM visible
        GROUP BY document_id, actor_kind, actor_plugin_id, run_id
        ORDER BY last_recorded_at DESC, document_id, run_id
        LIMIT ?
      `).all(...args, query.limit + 1) as ChangeRow[];
      return {
        changes: rows.slice(0, query.limit).map(toDocumentChange),
        truncated: rows.length > query.limit,
      };
    },

    summarizeProjectDocuments(projectId, documentIds) {
      const documentFilter = documentIds === undefined
        ? ''
        : 'AND node.id IN (SELECT value FROM json_each(?))';
      const args: string[] = documentIds === undefined ? [projectId] : [projectId, JSON.stringify(documentIds)];
      // 同一毫秒内的多条按自增 id 定先后；插件、对话身份只在改动发生在当前项目时可见。
      const rows = db.prepare<string[], SummaryRow>(`
        WITH ranked AS (
          SELECT entry.document_id, entry.action, entry.actor_kind, entry.recorded_at,
            CASE WHEN entry.project_id = node.project_id THEN entry.actor_plugin_id END AS plugin_id,
            CASE WHEN entry.project_id = node.project_id THEN entry.conversation_id END AS conversation_id,
            entry.agent_id,
            ROW_NUMBER() OVER (PARTITION BY entry.document_id ORDER BY entry.recorded_at, entry.id) AS first_rank,
            ROW_NUMBER() OVER (PARTITION BY entry.document_id ORDER BY entry.recorded_at DESC, entry.id DESC) AS last_rank
          FROM workspace_nodes node JOIN action_ledger_entries entry ON entry.document_id = node.id
          WHERE node.project_id = ? AND node.deleted_at IS NULL ${documentFilter}
        )
        SELECT first.document_id,
          first.action AS first_action, first.actor_kind AS first_actor_kind,
          first.plugin_id AS first_plugin_id, first.conversation_id AS first_conversation_id,
          first.agent_id AS first_agent_id,
          last.actor_kind AS last_actor_kind, last.plugin_id AS last_plugin_id, last.agent_id AS last_agent_id,
          last.recorded_at AS last_recorded_at
        FROM ranked first JOIN ranked last ON last.document_id = first.document_id AND last.last_rank = 1
        WHERE first.first_rank = 1
      `).all(...args);
      return rows.map(toDocumentSummary);
    },

    countDocumentsByConversation(projectId) {
      const rows = db.prepare<[string], { conversation_id: string; document_count: number }>(`
        SELECT entry.conversation_id, COUNT(DISTINCT entry.document_id) AS document_count
        FROM action_ledger_entries entry JOIN workspace_nodes node ON node.id = entry.document_id
        WHERE entry.project_id = ? AND node.project_id = entry.project_id AND entry.conversation_id IS NOT NULL
        GROUP BY entry.conversation_id
      `).all(projectId);
      return new Map(rows.map(row => [row.conversation_id, row.document_count]));
    },
  };
}

function toDocumentSummary(row: SummaryRow): ActionLedgerDocumentSummary {
  const created = assertOneOf(row.first_action, ACTIONS, 'action') === 'create';
  return {
    documentId: row.document_id,
    creator: created
      ? {
          actorKind: assertOneOf(row.first_actor_kind, ACTOR_KINDS, 'actor_kind'),
          pluginId: row.first_plugin_id,
          conversationId: row.first_conversation_id,
          agentId: row.first_agent_id,
        }
      : null,
    last: {
      actorKind: assertOneOf(row.last_actor_kind, ACTOR_KINDS, 'actor_kind'),
      pluginId: row.last_plugin_id,
      agentId: row.last_agent_id,
      recordedAt: row.last_recorded_at,
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
    agentId: row.agent_id,
    actions: row.actions.split(',').map(action => assertOneOf(action, ACTIONS, 'action')),
    entryCount: row.entry_count,
    granularity: minGranularity === maxGranularity ? minGranularity : 'mixed',
    firstRecordedAt: row.first_recorded_at,
    lastRecordedAt: row.last_recorded_at,
  };
}

/**
 * Agent 身份由 Host 从运行记录里查，不由工具上下文或 owner 提供：Linnkit 的工具上下文不带 Agent，
 * 运行记录在工具执行前已由对话持久化写入。没有运行表的装配（只建账本的测试）记为 null。
 */
export function createRunAgentIdReader(db: Database.Database): (runId: string) => string | null {
  const hasRuns = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
  if (!hasRuns) return () => null;
  const select = db.prepare<[string], { agent_spec_id: string | null }>('SELECT agent_spec_id FROM runs WHERE id = ?');
  return runId => select.get(runId)?.agent_spec_id ?? null;
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  const match = allowed.find(candidate => candidate === value);
  if (match === undefined) throw new Error(`行动账本 ${field} 不在合同范围内：${value}`);
  return match;
}
