import type Database from 'better-sqlite3';
import type { WorkspaceNodeTransferResult } from '@app/schemas';
import type { WorkspaceMutationPublisher } from '../../definitions/workspaceMutationPublisher';
import { createWorkspaceNodeTransferredEvent } from '../../functions/createWorkspaceNodeMutationEvent';
import { invalidateWorkspaceVfsSearchIndexNodes } from '../../vfs';
import { inspectWorkspaceNodeTransfer } from './inspectWorkspaceNodeTransfer';

function enqueueCommittedTransferEvent(params: {
  readonly db: Database.Database;
  readonly result: WorkspaceNodeTransferResult;
  readonly mutationPublisher?: WorkspaceMutationPublisher;
}): void {
  if (!params.mutationPublisher) return;
  const event = createWorkspaceNodeTransferredEvent(params.result);
  setTimeout(() => {
    const current = params.db.prepare(`
      SELECT project_id, parent_id
      FROM workspace_nodes
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(params.result.nodeId) as {
      project_id: string | null;
      parent_id: string | null;
    } | undefined;
    if (current?.project_id !== params.result.targetProjectId || current.parent_id !== null) return;
    params.mutationPublisher?.publish(event);
  }, 0);
}

export function transferWorkspaceNode(params: {
  readonly db: Database.Database;
  readonly nodeId: string;
  readonly targetProjectId: string;
  readonly mutationPublisher?: WorkspaceMutationPublisher;
}): WorkspaceNodeTransferResult {
  const transaction = params.db.transaction(() => {
    // 中文说明：预检只能服务 Renderer 的“先保存再移动”；真正写入前必须在同一事务内重验。
    const result = inspectWorkspaceNodeTransfer(params);
    const now = Date.now();

    params.db.prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM workspace_nodes WHERE id = ?
        UNION
        SELECT child.id
        FROM workspace_nodes child
        JOIN subtree parent ON child.parent_id = parent.id
      )
      UPDATE workspace_nodes
      SET
        project_id = ?,
        parent_id = CASE WHEN id = ? THEN NULL ELSE parent_id END,
        updated_at = ?
      WHERE id IN (SELECT id FROM subtree)
    `).run(params.nodeId, params.targetProjectId, params.nodeId, now);

    invalidateWorkspaceVfsSearchIndexNodes({
      db: params.db,
      projectId: result.sourceProjectId,
      nodeIds: result.movedNodeIds,
    });
    return result;
  });

  const result = transaction.immediate();
  enqueueCommittedTransferEvent({
    db: params.db,
    result,
    mutationPublisher: params.mutationPublisher,
  });
  return result;
}
