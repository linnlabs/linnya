import type Database from 'better-sqlite3';
import { toReadModelAgentId, type ProjectConversations, type ProjectConversationsRequest } from '@app/schemas';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { readConversationOrigin, readConversationRunAgents } from '../../../adapters/persistence/event-store';
import { listInternalAgentIds } from '../../../agent-registry/agentDefinitionResolver';
import { groupConversationAgents, selectRepliedAgents } from '../functions/conversationAgents';
import { toConversationStorage, type ConversationStorageUsageRow } from '../functions/conversationStorageRow';

interface ConversationListRow extends Partial<ConversationStorageUsageRow> {
  readonly conversation_id: string;
  readonly title: string;
  readonly selected_agent_id: string | null;
  readonly metadata: string | null;
  readonly user_message_count: number;
  readonly created_at: number;
  readonly last_event_at: number;
  readonly is_pinned: number;
  readonly measured_at?: number;
}

/**
 * 项目里的全部对话。回复过的 Agent 取自根运行（内部 Agent 不算；Linnya CLI 创建的对话没有 Agent 回复，见 `selectRepliedAgents`），
 * 当前选用的 Agent 取自对话；两者都按读取合同的写法，默认 Agent 为 null。发起入口取自对话 metadata。
 * 占用取缓存，过期或没测过时为 null，由调用方再请求测量。
 */
export function readProjectConversations(
  db: Database.Database,
  request: ProjectConversationsRequest,
): ProjectConversations {
  const rows = db.prepare<[string], ConversationListRow>(`
    SELECT c.conversation_id, c.title, c.user_message_count, c.created_at, c.last_event_at, c.is_pinned,
      c.selected_agent_id, c.metadata,
      s.record_bytes, s.attachment_bytes, s.has_shared_attachments, s.work_file_bytes, s.work_files_state, s.measured_at
    FROM conversations c
    LEFT JOIN conversation_storage_usage s ON s.conversation_id = c.conversation_id
    WHERE c.project_id = ?
    ORDER BY c.is_pinned DESC, c.last_event_at DESC
  `).all(request.project_id);
  const documentCounts = createSqliteActionLedger(db).countDocumentsByConversation(request.project_id);
  const agents = groupConversationAgents(
    readConversationRunAgents(db, { projectId: request.project_id }),
    listInternalAgentIds(),
  );
  return {
    project_id: request.project_id,
    conversations: rows.map(row => {
      const origin = readConversationOrigin(row.conversation_id, row.metadata);
      return {
        conversation_id: row.conversation_id,
        title: row.title,
        replied_agent_ids: selectRepliedAgents(origin, agents.get(row.conversation_id)),
        // 默认 Agent 选定后也会记成它的 ID；合同里统一为 null。
        selected_agent_id: toReadModelAgentId(row.selected_agent_id),
        ...(origin ? { origin } : {}),
        turn_count: row.user_message_count,
        changed_document_count: documentCounts.get(row.conversation_id) ?? 0,
        created_at: row.created_at,
        last_event_at: row.last_event_at,
        is_pinned: row.is_pinned === 1,
        storage: row.measured_at === undefined || row.measured_at === null
          ? null
          : toConversationStorage(row as ConversationStorageUsageRow, row.last_event_at),
      };
    }),
  };
}
