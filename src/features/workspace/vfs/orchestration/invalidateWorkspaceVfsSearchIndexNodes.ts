import type { WorkspaceVfsDatabase } from './listWorkspaceVfsNodes';
import { deleteWorkspaceVfsSearchIndexEntries, hasWorkspaceVfsSearchIndex } from './workspaceVfsSearchIndex';

function toWorkspaceInode(nodeId: string): string {
  return `workspace:${nodeId}`;
}

export function invalidateWorkspaceVfsSearchIndexNodes(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly nodeIds: readonly string[];
}): void {
  if (params.nodeIds.length === 0 || !hasWorkspaceVfsSearchIndex(params.db)) return;
  deleteWorkspaceVfsSearchIndexEntries({
    db: params.db,
    projectId: params.projectId,
    inodes: params.nodeIds.map(toWorkspaceInode),
  });
}
