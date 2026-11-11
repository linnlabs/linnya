import type { WorkspaceNodeDTO } from '@/shared/ipc/workspaceGateway';
import type { WorkspaceNode, WorkspaceNodePatch, WorkspaceNodeReconciliation, WorkspaceNodeStatePatch } from '../definitions/workspaceTree';

/** 只规划事实变化；同步 action 落地时保留旧节点身份、已加载子树和展开状态。 */
export function planNodeReconciliation(
  oldNodes: WorkspaceNode[] | null | undefined,
  newDataArray: WorkspaceNodeDTO[],
  depth: number,
  expandedIdsSet: Set<string> = new Set(),
): WorkspaceNodeReconciliation {
  if (!oldNodes) {
    return { nodes: newDataArray.map((node) => createNodeFromData(node, depth, expandedIdsSet)), patches: [] };
  }

  const oldNodesById = new Map(oldNodes.map((node) => [node.id, node]));
  const patches: WorkspaceNodeStatePatch[] = [];
  const nodes = newDataArray.map((newData) => {
    const existingNode = oldNodesById.get(newData.id);
    if (!existingNode) return createNodeFromData(newData, depth, expandedIdsSet);
    patches.push({ node: existingNode, changes: projectUpdatedNodeData(existingNode, newData) });
    return existingNode;
  });
  return { nodes, patches };
}

/** 把持久化 DTO 投影为 Renderer 树节点。 */
export function createNodeFromData(
  data: WorkspaceNodeDTO,
  depth: number,
  expandedIdsSet: Set<string> = new Set(),
): WorkspaceNode {
  return {
    id: data.id,
    inode: data.inode,
    path: data.path,
    projectId: data.project_id ?? '',
    parentId: data.parent_id,
    type: data.type,
    name: data.name,
    displayName: data.display_name,
    icon: data.icon ?? undefined,
    createdAt: data.created_at ? String(data.created_at) : undefined,
    updatedAt: data.updated_at ? String(data.updated_at) : undefined,
    deletedAt: data.deleted_at ? String(data.deleted_at) : undefined,
    children: data.type === 'folder' ? null : undefined,
    isVirtual: data.is_virtual === true,
    source: data.source,
    payload: data.payload,
    isExpanded: expandedIdsSet.has(data.id),
    depth,
  };
}

/** 只更新持久化事实，不能覆盖展开状态或已加载 children。 */
export function projectUpdatedNodeData(node: WorkspaceNode, newData: WorkspaceNodeDTO): WorkspaceNodePatch {
  return {
    type: newData.type,
    name: newData.name,
    displayName: newData.display_name,
    icon: newData.icon ?? undefined,
    inode: newData.inode,
    path: newData.path,
    isVirtual: newData.is_virtual === true,
    source: newData.source,
    payload: newData.payload,
    updatedAt: newData.updated_at ? String(newData.updated_at) : node.updatedAt,
  };
}

export function findNodeById(
  tree: WorkspaceNode[] | null | undefined,
  nodeId: string,
): WorkspaceNode | null {
  if (!tree) return null;
  for (const node of tree) {
    if (node.id === nodeId) return node;
    const found = findNodeById(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

export function isDescendant(
  tree: WorkspaceNode[] | null | undefined,
  potentialAncestorId: string,
  potentialDescendantId: string,
): boolean {
  const ancestor = findNodeById(tree, potentialAncestorId);
  if (!ancestor?.children) return false;
  return findNodeById(ancestor.children, potentialDescendantId) !== null;
}
