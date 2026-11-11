import type { SemanticSchemaUsage } from '@app/schemas';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

/** “3 份文档 · 1 个项目 · 1 个保存的筛选”；没有的部分不写。 */
export function usageMetaText(usage: SemanticSchemaUsage, message: WorkspaceMessageResolver): string {
  const documents = usage.projects.reduce((sum, project) => sum + project.document_count, 0);
  return [
    message('workspace.semanticSchema.usage.documents', { count: documents }),
    documents ? message('workspace.semanticSchema.usage.projects', { count: usage.projects.length }) : '',
    usage.saved_filters.length ? message('workspace.semanticSchema.usage.filters', { count: usage.saved_filters.length }) : '',
  ].filter(Boolean).join(' · ');
}

/** 按项目分组的文档；项目顺序与文档顺序沿用 Backend 的排序。 */
export function groupUsageDocuments(usage: SemanticSchemaUsage) {
  return usage.projects.map(project => ({
    project,
    documents: usage.documents.filter(document => document.project_id === project.id),
  }));
}
