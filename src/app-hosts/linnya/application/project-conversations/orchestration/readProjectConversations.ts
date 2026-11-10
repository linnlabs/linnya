import type Database from 'better-sqlite3';
import { PromptKeys, type ProjectConversations, type ProjectConversationsRequest } from '@app/schemas';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { toConversationStorage, type ConversationStorageUsageRow } from '../functions/conversationStorageRow';

interface ConversationListRow extends Partial<ConversationStorageUsageRow> {
  readonly conversation_id: string;
  readonly title: string;
  readonly agent_id: string | null;
  readonly user_message_count: number;
  readonly created_at: number;
  readonly last_event_at: number;
  readonly is_pinned: number;
  readonly measured_at?: number;
}

/**
 * 项目里的全部对话。Agent 只取对话选定的 Agent：没有选定或选的就是默认 Agent 时为 null。
 * 不从运行记录推断：标题生成等内部运行也是对话里的根运行，会被误认成对话的 Agent。
 * 占用取缓存，过期或没测过时为 null，由调用方再请求测量。
 */
export function readProjectConversations(
  db: Database.Database,
  request: ProjectConversationsRequest,
): ProjectConversations {
  const rows = db.prepare<[string], ConversationListRow>(`
    SELECT c.conversation_id, c.title, c.user_message_count, c.created_at, c.last_event_at, c.is_pinned,
      c.selected_agent_id AS agent_id,
      s.record_bytes, s.attachment_bytes, s.has_shared_attachments, s.work_file_bytes, s.work_files_state, s.measured_at
    FROM conversations c
    LEFT JOIN conversation_storage_usage s ON s.conversation_id = c.conversation_id
    WHERE c.project_id = ?
    ORDER BY c.is_pinned DESC, c.last_event_at DESC
  `).all(request.project_id);
  const documentCounts = createSqliteActionLedger(db).countDocumentsByConversation(request.project_id);
  return {
    project_id: request.project_id,
    conversations: rows.map(row => ({
      conversation_id: row.conversation_id,
      title: row.title,
      // 默认 Agent 选定后也会记成它的 ID；合同里统一为 null。
      agent_id: row.agent_id === PromptKeys.DEFAULT ? null : row.agent_id,
      turn_count: row.user_message_count,
      changed_document_count: documentCounts.get(row.conversation_id) ?? 0,
      created_at: row.created_at,
      last_event_at: row.last_event_at,
      is_pinned: row.is_pinned === 1,
      storage: row.measured_at === undefined || row.measured_at === null
        ? null
        : toConversationStorage(row as ConversationStorageUsageRow, row.last_event_at),
    })),
  };
}
