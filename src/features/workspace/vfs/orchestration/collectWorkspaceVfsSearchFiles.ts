import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import { listWorkspaceVfsNodes, type ListWorkspaceVfsNodesParams } from './listWorkspaceVfsNodes';

/** 索引和无索引搜索共享遍历预算；未遍历范围不能变成“没有命中”。 */
export async function collectWorkspaceVfsSearchFiles(
  params: ListWorkspaceVfsNodesParams,
  startNode: WorkspaceVfsNode | null,
  maxVisitedNodes: number,
): Promise<{ readonly files: WorkspaceVfsNode[]; readonly visitedNodes: number; readonly truncated: boolean }> {
  if (startNode && startNode.type !== 'folder') {
    return { files: [startNode], visitedNodes: 1, truncated: false };
  }

  const files: WorkspaceVfsNode[] = [];
  const queue: Array<string | null> = [startNode ? startNode.id : null];
  let visitedNodes = 0;
  while (queue.length > 0) {
    const parentId = queue.shift() ?? null;
    const children = await listWorkspaceVfsNodes({ ...params, parentId });
    for (const child of children) {
      if (visitedNodes >= maxVisitedNodes) {
        return { files, visitedNodes, truncated: true };
      }
      visitedNodes += 1;
      if (child.type === 'folder') queue.push(child.id);
      else files.push(child);
    }
  }
  return { files, visitedNodes, truncated: false };
}
