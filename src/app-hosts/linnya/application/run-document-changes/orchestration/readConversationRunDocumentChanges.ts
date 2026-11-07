import type Database from 'better-sqlite3';
import type {
  ConversationRunDocumentChange,
  ConversationRunDocumentChanges,
  ConversationRunDocumentChangesRequest,
} from '@app/schemas';
import {
  ACTION_LEDGER_MAX_QUERY_LIMIT,
  createSqliteActionLedger,
  type ActionLedgerDocumentChange,
} from 'src/domains/action-ledger';
import { createMarkdownReadDatabase, MarkdownPendingRevisionReader } from 'src/domains/markdown';
import { readWorkspaceNodeIdentityIncludingDeleted } from 'src/features/workspace/vfs';
import { mergeRunDocumentChanges } from '../functions/mergeRunDocumentChanges';

/** 内建 Markdown 的节点类型；只有它有待审阅修订。 */
const MARKDOWN_NODE_TYPE = 'document';

/**
 * 按会话所属项目查这些根运行（含子运行）改过的文档。项目由会话决定，不信任 Renderer 传入；
 * 每份文档只带自己 owner 的状态：Markdown 给待审阅修订数，其他类型不在这里解释。
 */
export function readConversationRunDocumentChanges(
  db: Database.Database,
  request: ConversationRunDocumentChangesRequest,
): ConversationRunDocumentChanges {
  const conversation = db.prepare<[string], { project_id: string | null }>(
    'SELECT project_id FROM conversations WHERE conversation_id = ? LIMIT 1',
  ).get(request.conversation_id);
  const projectId = conversation?.project_id?.trim();
  if (!projectId) return { documents: [], truncated: false };

  const ledger = createSqliteActionLedger(db);
  const changes: ActionLedgerDocumentChange[] = [];
  let truncated = false;
  for (const rootRunId of new Set(request.root_run_ids)) {
    const result = ledger.listDocumentChanges({ projectId, rootRunId, limit: ACTION_LEDGER_MAX_QUERY_LIMIT });
    truncated ||= result.truncated;
    changes.push(...result.changes);
  }

  const pendingReader = new MarkdownPendingRevisionReader(createMarkdownReadDatabase(db));
  const documents: ConversationRunDocumentChange[] = [];
  for (const change of mergeRunDocumentChanges(changes)) {
    const node = readWorkspaceNodeIdentityIncludingDeleted(db, change.documentId);
    // 账本只列当前项目的改动；节点不可见（如资源库）或已转走时不展示。
    if (!node || node.projectId !== projectId) continue;
    documents.push({
      document_id: node.id,
      project_id: projectId,
      node_type: node.type,
      title: node.title,
      parent_id: node.parentId,
      presence: node.deleted ? 'deleted' : 'present',
      created: change.created,
      actor: change.actor,
      last_recorded_at: change.lastRecordedAt,
      pending_revision_count: node.type === MARKDOWN_NODE_TYPE && !node.deleted
        ? pendingReader.getPendingRevisionsCount(node.id)
        : null,
    });
  }
  return { documents, truncated };
}
