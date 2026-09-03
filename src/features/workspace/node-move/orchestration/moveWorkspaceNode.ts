import type Database from 'better-sqlite3';
import {
  WorkspaceNodeNotFoundError,
  WorkspaceSiblingNameConflictError,
} from '../../definitions/workspaceErrors';
import type { WorkspaceMutationNodeSnapshot } from '../../functions/createWorkspaceNodeMutationEvent';
import { assertWorkspaceNodeMoveAllowed } from './assertWorkspaceNodeMoveAllowed';

export function moveWorkspaceNode(params: {
  readonly db: Database.Database;
  readonly nodeId: string;
  readonly newParentId: string | null;
}): WorkspaceMutationNodeSnapshot {
  const node = params.db.prepare(`
    SELECT id, project_id, parent_id, type, name
    FROM workspace_nodes
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(params.nodeId) as WorkspaceMutationNodeSnapshot | undefined;
  if (!node) throw new WorkspaceNodeNotFoundError(params.nodeId);

  assertWorkspaceNodeMoveAllowed({
    db: params.db,
    node,
    newParentId: params.newParentId,
  });

  const conflict = params.db.prepare(`
    SELECT id
    FROM workspace_nodes
    WHERE
      project_id IS ?
      AND parent_id IS ?
      AND name = ?
      AND id <> ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(node.project_id, params.newParentId, node.name, node.id) as { id: string } | undefined;
  if (conflict) {
    throw new WorkspaceSiblingNameConflictError(node.name, node.project_id, params.newParentId);
  }

  const update = params.db.prepare(`
    UPDATE workspace_nodes
    SET parent_id = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(params.newParentId, Date.now(), params.nodeId);
  if (update.changes === 0) throw new WorkspaceNodeNotFoundError(params.nodeId);

  return node;
}
