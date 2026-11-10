import type Database from 'better-sqlite3';
import type { ProjectOverview, ProjectOverviewRequest } from '@app/schemas';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { createMarkdownReadDatabase, MarkdownPendingRevisionReader } from 'src/domains/markdown';
import { createSqliteSemanticLayer } from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { listWorkspaceProjectDocuments } from 'src/features/workspace/vfs';
import { readProjectConversationTitles } from '../../../adapters/persistence/event-store';
import { projectOverviewDocument } from '../functions/projectOverviewDocument';

/** 内建 Markdown 的节点类型；只有它有待审阅修订。 */
const MARKDOWN_NODE_TYPE = 'document';

/**
 * 项目概览的一张表：VFS 给出文档与位置，行动账本给出谁新建、最近谁改，对话给出标题，
 * Markdown 给出待审阅数，语义层给出标签。各 owner 只给自己的事实，这里不解释插件文档的内部状态。
 */
export function readProjectOverview(
  db: Database.Database,
  request: ProjectOverviewRequest,
): ProjectOverview {
  const projectId = request.project_id;
  const listed = listWorkspaceProjectDocuments(db, projectId);
  const wanted = request.document_ids === undefined ? null : new Set(request.document_ids);
  const documents = wanted === null
    ? listed.documents
    : listed.documents.filter(document => wanted.has(document.id));

  const summaries = new Map(
    createSqliteActionLedger(db)
      .summarizeProjectDocuments(projectId, request.document_ids)
      .map(summary => [summary.documentId, summary]),
  );
  const conversationIds = [...summaries.values()]
    .map(summary => summary.creator?.conversationId ?? null)
    .filter((id): id is string => id !== null);
  const conversationTitles = readProjectConversationTitles(db, projectId, conversationIds);
  const tags = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) })
    .listObjectTags('document', documents.map(document => document.id));
  const pendingCounts = new MarkdownPendingRevisionReader(createMarkdownReadDatabase(db)).getPendingRevisionCounts(
    documents.filter(document => document.type === MARKDOWN_NODE_TYPE).map(document => document.id),
  );

  return {
    project_id: projectId,
    documents: documents.map(document => projectOverviewDocument({
      document,
      summary: summaries.get(document.id),
      conversationTitles,
      pendingRevisionCount: document.type === MARKDOWN_NODE_TYPE ? pendingCounts.get(document.id) ?? 0 : null,
      tags: tags.get(document.id) ?? [],
    })),
    folder_count: wanted === null ? listed.folderCount : null,
  };
}
