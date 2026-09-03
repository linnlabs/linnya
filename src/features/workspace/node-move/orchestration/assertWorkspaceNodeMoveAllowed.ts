import type Database from 'better-sqlite3';
import {
  WorkspaceNodeMoveCycleError,
  WorkspaceNodeParentNotFolderError,
  WorkspaceNodeParentNotFoundError,
  WorkspaceNodeParentProjectMismatchError,
} from '../../definitions/workspaceErrors';

interface WorkspaceNodePlacementRow {
  readonly id: string;
  readonly project_id: string | null;
  readonly type: string;
}

export function assertWorkspaceNodeMoveAllowed(params: {
  readonly db: Database.Database;
  readonly node: WorkspaceNodePlacementRow;
  readonly newParentId: string | null;
}): void {
  if (params.newParentId === null) return;

  if (params.newParentId === params.node.id) {
    throw new WorkspaceNodeMoveCycleError(params.node.id, params.newParentId);
  }

  const parent = params.db.prepare(`
    SELECT id, project_id, type
    FROM workspace_nodes
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(params.newParentId) as WorkspaceNodePlacementRow | undefined;

  if (!parent) {
    throw new WorkspaceNodeParentNotFoundError(params.newParentId);
  }
  if (parent.type !== 'folder') {
    throw new WorkspaceNodeParentNotFolderError(params.newParentId);
  }
  if (parent.project_id !== params.node.project_id) {
    throw new WorkspaceNodeParentProjectMismatchError(params.newParentId);
  }

  const descendant = params.db.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM workspace_nodes WHERE id = ?
      UNION
      SELECT child.id
      FROM workspace_nodes child
      JOIN subtree parent ON child.parent_id = parent.id
    )
    SELECT id FROM subtree WHERE id = ? LIMIT 1
  `).get(params.node.id, params.newParentId) as { id: string } | undefined;

  if (descendant) {
    throw new WorkspaceNodeMoveCycleError(params.node.id, params.newParentId);
  }
}
