import type Database from 'better-sqlite3';
import type { WorkspaceDocumentMutationPort } from '../../definitions/workspaceDocumentMutationPort';

export function createSqliteWorkspaceDocumentMutationPort(
  db: Database.Database,
): WorkspaceDocumentMutationPort {
  return {
    touchDocumentUpdatedAt(documentId, updatedAt) {
      db.prepare(`
        UPDATE workspace_nodes
        SET updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(updatedAt, documentId);
    },
  };
}
