import type Database from 'better-sqlite3';
import type {
  ProjectConversationChangedDocument,
  ProjectConversationDetail,
  ProjectConversationDetailRequest,
} from '@app/schemas';
import { ACTION_LEDGER_MAX_QUERY_LIMIT, createSqliteActionLedger } from 'src/domains/action-ledger';
import { createMarkdownReadDatabase, MarkdownPendingRevisionReader } from 'src/domains/markdown';
import { readWorkspaceNodeIdentityIncludingDeleted } from 'src/features/workspace/vfs';
import { clipConversationText } from '../functions/conversationExcerpt';
import { toConversationStorage, type ConversationStorageUsageRow } from '../functions/conversationStorageRow';

const MARKDOWN_NODE_TYPE = 'document';

/**
 * 对话详情只放已有事实，不调用模型：第一条用户输入、最后一条最终答复（截取原文）、
 * 这个对话在本项目改过的文档、占用。对话不属于该项目时返回 null。
 */
export function readProjectConversationDetail(
  db: Database.Database,
  request: ProjectConversationDetailRequest,
): ProjectConversationDetail | null {
  const conversation = db.prepare<[string, string], { last_event_at: number }>(
    'SELECT last_event_at FROM conversations WHERE conversation_id = ? AND project_id = ?',
  ).get(request.conversation_id, request.project_id);
  if (!conversation) return null;

  const readContent = (messageType: string, order: 'ASC' | 'DESC') => db.prepare<[string, string], { content: string }>(`
    SELECT content FROM conversation_readable_messages
    WHERE conversation_id = ? AND message_type = ? ORDER BY sort_seq ${order} LIMIT 1
  `).get(request.conversation_id, messageType)?.content ?? null;
  const firstQuestion = readContent('user_input', 'ASC');
  const lastAnswer = readContent('final_answer', 'DESC');

  const changes = createSqliteActionLedger(db).listDocumentChanges({
    projectId: request.project_id,
    conversationId: request.conversation_id,
    limit: ACTION_LEDGER_MAX_QUERY_LIMIT,
  }).changes;
  const latestByDocument = new Map<string, number>();
  for (const change of changes) {
    latestByDocument.set(change.documentId, Math.max(latestByDocument.get(change.documentId) ?? 0, change.lastRecordedAt));
  }
  const pendingReader = new MarkdownPendingRevisionReader(createMarkdownReadDatabase(db));
  const changedDocuments: ProjectConversationChangedDocument[] = [];
  for (const [documentId, lastChangedAt] of [...latestByDocument].sort((left, right) => right[1] - left[1])) {
    const node = readWorkspaceNodeIdentityIncludingDeleted(db, documentId);
    if (!node || node.projectId !== request.project_id) continue;
    changedDocuments.push({
      document_id: node.id,
      node_type: node.type,
      title: node.title,
      parent_id: node.parentId,
      deleted: node.deleted,
      last_changed_at: lastChangedAt,
      pending_revision_count: node.type === MARKDOWN_NODE_TYPE && !node.deleted
        ? pendingReader.getPendingRevisionsCount(node.id)
        : null,
    });
  }

  const storage = db.prepare<[string], ConversationStorageUsageRow>(
    'SELECT * FROM conversation_storage_usage WHERE conversation_id = ?',
  ).get(request.conversation_id);
  return {
    conversation_id: request.conversation_id,
    first_question: firstQuestion === null ? null : clipConversationText(firstQuestion),
    last_answer: lastAnswer === null ? null : clipConversationText(lastAnswer),
    changed_documents: changedDocuments,
    storage: toConversationStorage(storage, conversation.last_event_at),
  };
}
