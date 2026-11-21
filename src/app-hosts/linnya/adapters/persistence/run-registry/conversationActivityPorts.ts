import type Database from 'better-sqlite3';
import type { CommandApprovalControlPort } from 'src/domains/commands';
import type {
  ConversationActivityCandidate,
  ConversationActivityListPorts,
} from '../../../application/conversation-activity';
import { ACTIVE_RUN_STATUSES, TERMINAL_RUN_STATUSES, type ConversationControlRunRecord } from '../../../application/conversation-control';

interface ActivityCandidateRow {
  conversation_id: string;
  project_id: string | null;
}

interface ActivityRunRow {
  id: string;
  conversation_id: string;
  parent_run_id: string | null;
  status: ConversationControlRunRecord['status'];
  start_ts: number;
  updated_ts: number;
  paused_ts: number | null;
  pause_reason: string | null;
  lane: string | null;
}

/** 只投影状态选择需要的候选及后代，不把每轮 prompt/执行 metadata 搬到查询进程。 */
export function createConversationActivityPorts(
  db: Database.Database,
  approvals: Pick<CommandApprovalControlPort, 'readControlPending'>,
): ConversationActivityListPorts {
  const activeParameters = ACTIVE_RUN_STATUSES.map(() => '?').join(', ');
  const terminalParameters = TERMINAL_RUN_STATUSES.map(() => '?').join(', ');
  // 活跃根全部保留，让 selectStatusRun 继续检查冲突；终态只需最近一个。
  // 状态集合来自同一 owner。不能直接 LIMIT 最新根，否则较老的活跃运行会被隐藏。
  const query = `
    WITH RECURSIVE requested AS (SELECT value AS id FROM json_each(?)),
    roots AS (
      SELECT id FROM runs WHERE conversation_id IN (SELECT id FROM requested)
        AND parent_run_id IS NULL AND json_extract(metadata_json, '$.lane') = 'foreground'
        AND status IN (${activeParameters})
      UNION
      SELECT (SELECT id FROM runs WHERE conversation_id = requested.id
        AND parent_run_id IS NULL AND json_extract(metadata_json, '$.lane') = 'foreground'
        AND status IN (${terminalParameters})
        ORDER BY COALESCE(updated_ts, start_ts) DESC, start_ts DESC, id DESC LIMIT 1)
      FROM requested
    ), scope AS (
      SELECT runs.id, runs.conversation_id FROM runs JOIN roots ON roots.id = runs.id
      UNION ALL
      SELECT child.id, child.conversation_id FROM runs child JOIN scope parent
        ON child.parent_run_id = parent.id AND child.conversation_id = parent.conversation_id
    )
    SELECT runs.id, runs.conversation_id, runs.parent_run_id, runs.status, runs.start_ts,
      COALESCE(runs.updated_ts, runs.start_ts) AS updated_ts, runs.paused_ts, runs.pause_reason,
      json_extract(runs.metadata_json, '$.lane') AS lane
    FROM runs JOIN scope ON runs.id = scope.id
    ORDER BY runs.start_ts DESC, COALESCE(runs.updated_ts, runs.start_ts) DESC, runs.id DESC
  `;
  // 全工作区候选：活跃前台根，或最近一次终态前台根是 failed/cancelled 的对话。终态先后与
  // readCandidates 的 LIMIT 1 用同一排序；后面跟着 completed 根的旧中断不进入候选。
  // 规划器默认会走 parent_run_id 索引扫全表，指定状态索引后只碰非 completed 的运行。
  const interruptedStatuses = TERMINAL_RUN_STATUSES.filter(status => status !== 'completed');
  const interruptedParameters = interruptedStatuses.map(() => '?').join(', ');
  const candidateQuery = `
    SELECT DISTINCT conversations.conversation_id, conversations.project_id
    FROM runs AS root INDEXED BY idx_runs_status_start_ts
    JOIN conversations ON conversations.conversation_id = root.conversation_id
    WHERE root.status IN (${activeParameters}, ${interruptedParameters})
      AND root.parent_run_id IS NULL AND json_extract(root.metadata_json, '$.lane') = 'foreground'
      AND (root.status IN (${activeParameters}) OR NOT EXISTS (
        SELECT 1 FROM runs AS later
        WHERE later.conversation_id = root.conversation_id
          AND later.parent_run_id IS NULL AND json_extract(later.metadata_json, '$.lane') = 'foreground'
          AND later.status IN (${terminalParameters})
          AND (COALESCE(later.updated_ts, later.start_ts), later.start_ts, later.id)
            > (COALESCE(root.updated_ts, root.start_ts), root.start_ts, root.id)
      ))
  `;
  return { runs: { async readCandidates(conversationIds) {
    const records = new Map<string, ConversationControlRunRecord[]>();
    if (conversationIds.length === 0) return records;
    // 端口装配不访问表；只有实际查询才准备语句，普通 Shell 启动不触发对话读取。
    const statement = db.prepare<[string, ...string[]], ActivityRunRow>(query);
    for (const row of statement.all(JSON.stringify(conversationIds), ...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES)) {
      const conversation = records.get(row.conversation_id) ?? [];
      conversation.push({ runId: row.id, conversationId: row.conversation_id,
        parentRunId: row.parent_run_id ?? undefined, status: row.status,
        startedAt: row.start_ts, updatedAt: row.updated_ts, pausedAt: row.paused_ts ?? undefined,
        pauseReason: row.pause_reason ?? undefined, metadata: { lane: row.lane } });
      records.set(row.conversation_id, conversation);
    }
    return records;
  }, async listActivityCandidates(): Promise<readonly ConversationActivityCandidate[]> {
    const statement = db.prepare<string[], ActivityCandidateRow>(candidateQuery);
    return statement.all(...ACTIVE_RUN_STATUSES, ...interruptedStatuses, ...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES)
      .map(row => ({ conversationId: row.conversation_id, projectId: row.project_id }));
  } }, approvals };
}
