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
 * Markdown 给出待审阅数，语义层给出标签与字段值。各 owner 只给自己的事实，这里不解释插件文档的内部状态。
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
  const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  const documentIds = documents.map(document => document.id);
  const tags = layer.listObjectTags('document', documentIds);
  const values = layer.listObjectValues('document', documentIds);
  const tagDefinitions = layer.listTags();
  const fieldsByTag = new Map(tagDefinitions.map(tag => [tag.id, tag.fields.map(field => field.propertyId)]));
  const taggedFieldIds = new Set(tagDefinitions.flatMap(tag => tag.fields.map(field => field.propertyId)));
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
      properties: {
        revision: values.get(document.id)?.revision ?? 0,
        // 字段跟随标签：按打标签的先后与标签内字段顺序，多个标签共用的字段只出现一次。
        field_ids: [...new Set((tags.get(document.id) ?? []).flatMap(tag => fieldsByTag.get(tag.id) ?? []))],
        values: { ...values.get(document.id)?.values },
      },
    })),
    folder_count: wanted === null ? listed.folderCount : null,
    fields: layer.listProperties()
      .filter(property => taggedFieldIds.has(property.id))
      .map(property => ({
        id: property.id,
        name: property.name,
        value_type: property.valueType,
        options: property.options.map(option => ({ id: option.id, name: option.name })),
        readonly: property.ownerPluginId !== null,
      })),
  };
}
