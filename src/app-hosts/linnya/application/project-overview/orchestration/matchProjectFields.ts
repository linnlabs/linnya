import type Database from 'better-sqlite3';
import type { ProjectOverviewMatchRequest, ProjectOverviewMatchResult } from '@app/schemas';
import { createSqliteSemanticLayer, matchSemanticQuery, SemanticLayerError } from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';

/** 字段条件 → 文档 ID。与 `linnya query` 同一份编译器，界面和 CLI 对“为空”“包含”的理解一致。 */
export function matchProjectFields(
  db: Database.Database,
  request: ProjectOverviewMatchRequest,
): ProjectOverviewMatchResult {
  const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  try {
    const ids = matchSemanticQuery(
      db,
      { projectId: request.project_id, where: request.where },
      { tags: layer.listTags(), properties: layer.listProperties() },
    );
    return { ok: true, document_ids: ids };
  } catch (error) {
    if (error instanceof SemanticLayerError) return { ok: false, message: error.message };
    throw error;
  }
}
