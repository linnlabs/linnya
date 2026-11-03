import type Database from 'better-sqlite3';
import { readActiveWorkspaceSubtreeNodeIds } from 'src/features/workspace/node-deletion';
import { readDocumentDeletionReferences } from 'src/domains/document-references';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
/** Host 组合真实 Workspace 删除范围与引用索引；两个领域不直接依赖彼此内部。 */
export function readWorkspaceDeletionReferencePreview(db: Database.Database, nodeIds: readonly string[]) {
  const scope = readActiveWorkspaceSubtreeNodeIds(db, nodeIds);
  return readDocumentDeletionReferences(db, scope, { read: id => readWorkspaceDocumentIdentity(db, id) });
}
