import type Database from 'better-sqlite3';
import type { WorkspaceNodeTransferResult } from '@app/schemas';
import {
  WorkspaceNodeMissingProjectError,
  WorkspaceNodeNotFoundError,
  WorkspaceNodeSubtreeProjectMismatchError,
  WorkspaceNodeTransferSameProjectError,
  WorkspaceProjectNotFoundError,
  WorkspaceSiblingNameConflictError,
} from '../../definitions/workspaceErrors';

interface TransferNodeRow {
  readonly id: string;
  readonly project_id: string | null;
  readonly parent_id: string | null;
  readonly type: string;
  readonly name: string;
  readonly deleted_at: number | null;
}

function assertProjectExists(db: Database.Database, projectId: string): void {
  const project = db.prepare(`
    SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1
  `).get(projectId) as { id: string } | undefined;
  if (!project) throw new WorkspaceProjectNotFoundError(projectId);
}

function readTransferSubtree(db: Database.Database, nodeId: string): TransferNodeRow[] {
  return db.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM workspace_nodes WHERE id = ?
      UNION
      SELECT child.id
      FROM workspace_nodes child
      JOIN subtree parent ON child.parent_id = parent.id
    )
    SELECT id, project_id, parent_id, type, name, deleted_at
    FROM workspace_nodes
    WHERE id IN (SELECT id FROM subtree)
  `).all(nodeId) as TransferNodeRow[];
}

export function inspectWorkspaceNodeTransfer(params: {
  readonly db: Database.Database;
  readonly nodeId: string;
  readonly targetProjectId: string;
}): WorkspaceNodeTransferResult {
  const node = params.db.prepare(`
    SELECT id, project_id, parent_id, type, name, deleted_at
    FROM workspace_nodes
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(params.nodeId) as TransferNodeRow | undefined;
  if (!node) throw new WorkspaceNodeNotFoundError(params.nodeId);
  if (!node.project_id) throw new WorkspaceNodeMissingProjectError(params.nodeId);

  assertProjectExists(params.db, node.project_id);
  assertProjectExists(params.db, params.targetProjectId);
  if (node.project_id === params.targetProjectId) {
    throw new WorkspaceNodeTransferSameProjectError(params.targetProjectId);
  }

  const conflict = params.db.prepare(`
    SELECT id
    FROM workspace_nodes
    WHERE project_id = ? AND parent_id IS NULL AND name = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(params.targetProjectId, node.name) as { id: string } | undefined;
  if (conflict) {
    throw new WorkspaceSiblingNameConflictError(node.name, params.targetProjectId, null);
  }

  const subtree = readTransferSubtree(params.db, params.nodeId);
  if (subtree.some((candidate) => candidate.project_id !== node.project_id)) {
    throw new WorkspaceNodeSubtreeProjectMismatchError(params.nodeId);
  }
  const movedNodeIds = subtree
    .filter((candidate) => candidate.deleted_at === null)
    .map((candidate) => candidate.id);

  return {
    nodeId: node.id,
    nodeType: node.type,
    nodeName: node.name,
    sourceProjectId: node.project_id,
    sourceParentId: node.parent_id,
    targetProjectId: params.targetProjectId,
    targetParentId: null,
    movedNodeIds,
  };
}
