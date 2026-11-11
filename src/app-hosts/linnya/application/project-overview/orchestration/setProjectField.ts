import type Database from 'better-sqlite3';
import type { ProjectOverviewSetFieldRequest, ProjectOverviewSetFieldResult } from '@app/schemas';
import { createSqliteSemanticLayer, SemanticLayerError } from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';

/**
 * 看板拖动改值：按期望版本写一个字段。执行者由 Renderer 请求入口绑定为用户，改动记进行动账本，
 * 可以在文档历史里按次恢复。
 */
export function setProjectField(
  db: Database.Database,
  request: ProjectOverviewSetFieldRequest,
): ProjectOverviewSetFieldResult {
  const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  try {
    const state = layer.setValues(
      { projectId: request.project_id, ref: { kind: 'document', id: request.document_id }, expectedRevision: request.expected_revision },
      { [request.field_id]: request.value },
    );
    return { ok: true, revision: state.revision };
  } catch (error) {
    if (error instanceof SemanticLayerError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
