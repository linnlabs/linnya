import type { WorkspaceVfsDatabase } from './listWorkspaceVfsNodes';
import { hasWorkspaceVfsSearchIndex } from './workspaceVfsSearchIndex';

const MAX_INVALIDATION_BATCH_SIZE = 400;

function toWorkspaceInode(nodeId: string): string {
  return `workspace:${nodeId}`;
}

export function invalidateWorkspaceVfsSearchIndexNodes(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly nodeIds: readonly string[];
}): void {
  if (params.nodeIds.length === 0 || !hasWorkspaceVfsSearchIndex(params.db)) return;

  for (let offset = 0; offset < params.nodeIds.length; offset += MAX_INVALIDATION_BATCH_SIZE) {
    const inodes = params.nodeIds
      .slice(offset, offset + MAX_INVALIDATION_BATCH_SIZE)
      .map(toWorkspaceInode);
    const placeholders = inodes.map(() => '?').join(', ');

    params.db.prepare(`
      DELETE FROM workspace_vfs_search_grams
      WHERE line_id IN (
        SELECT id
        FROM workspace_vfs_search_lines
        WHERE project_id = ? AND inode IN (${placeholders})
      )
    `).run(params.projectId, ...inodes);

    params.db.prepare(`
      DELETE FROM workspace_vfs_search_lines
      WHERE project_id = ? AND inode IN (${placeholders})
    `).run(params.projectId, ...inodes);
  }
}
