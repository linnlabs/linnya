import type Database from 'better-sqlite3';
import { CONVERSATION_RUN_KIND } from '../../definitions/conversationRunKind';

/** 一个对话里同一 Agent 的根运行或子运行汇总。 */
export interface ConversationRunAgentRow {
  readonly conversationId: string;
  /** `runs.agent_spec_id`，未记录时为 null。 */
  readonly agentSpecId: string | null;
  /** true 为根运行（对话里的一次回复），false 为派出的子运行（含多层）。 */
  readonly isRoot: boolean;
  readonly runCount: number;
  readonly lastStartedAt: number;
}

interface RunAgentSqlRow {
  readonly conversation_id: string;
  readonly agent_spec_id: string | null;
  readonly is_root: number;
  readonly run_count: number;
  readonly last_started_at: number;
}

/**
 * 按对话汇总 Agent 执行（`kind = agent`）由哪些 Agent 完成，根运行与子运行分开计数。
 * 只读运行事实，不解释哪些 Agent 是内部能力、也不决定显示名；范围是一个项目的全部对话或单个对话。
 */
export function readConversationRunAgents(
  db: Database.Database,
  scope: { readonly projectId: string } | { readonly conversationId: string },
): ConversationRunAgentRow[] {
  const where = 'projectId' in scope
    ? 'r.conversation_id IN (SELECT conversation_id FROM conversations WHERE project_id = ?)'
    : 'r.conversation_id = ?';
  const rows = db.prepare<[string, string], RunAgentSqlRow>(`
    SELECT r.conversation_id, r.agent_spec_id, (r.parent_run_id IS NULL) AS is_root,
      COUNT(*) AS run_count, MAX(r.start_ts) AS last_started_at
    FROM runs r
    WHERE r.kind = ? AND ${where}
    GROUP BY r.conversation_id, r.agent_spec_id, is_root
  `).all(CONVERSATION_RUN_KIND.AGENT, 'projectId' in scope ? scope.projectId : scope.conversationId);
  return rows.map(row => ({
    conversationId: row.conversation_id,
    agentSpecId: row.agent_spec_id,
    isRoot: row.is_root === 1,
    runCount: row.run_count,
    lastStartedAt: row.last_started_at,
  }));
}
