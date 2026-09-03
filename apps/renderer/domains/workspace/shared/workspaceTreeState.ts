import type { WorkspaceNode } from '../definitions/workspaceTree';

export interface WorkspaceNodeDTO {
  id: string;
  inode?: string;
  path?: string;
  project_id: string | null;
  parent_id: string | null;
  type: string;
  name: string;
  display_name?: string;
  icon: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  is_virtual?: boolean;
  source?: string;
  payload?: Record<string, unknown>;
}

/** 合并后端节点事实，同时保留已加载子树和展开状态。 */
export function reconcileNodeArrays(
  oldNodes: WorkspaceNode[] | null | undefined,
  newDataArray: WorkspaceNodeDTO[],
  depth: number,
  expandedIdsSet: Set<string> = new Set(),
): WorkspaceNode[] {
  if (!oldNodes) {
    return newDataArray.map((node) => createNodeFromData(node, depth, expandedIdsSet));
  }

  const oldNodesById = new Map(oldNodes.map((node) => [node.id, node]));
  return newDataArray.map((newData) => {
    const existingNode = oldNodesById.get(newData.id);
    if (!existingNode) return createNodeFromData(newData, depth, expandedIdsSet);
    updateNodeData(existingNode, newData);
    return existingNode;
  });
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
export function updateNodeData(node: WorkspaceNode, newData: WorkspaceNodeDTO): void {
  node.type = newData.type;
  node.name = newData.name;
  node.displayName = newData.display_name;
  node.icon = newData.icon ?? undefined;
  node.inode = newData.inode;
  node.path = newData.path;
  node.isVirtual = newData.is_virtual === true;
  node.source = newData.source;
  node.payload = newData.payload;
  node.updatedAt = newData.updated_at ? String(newData.updated_at) : node.updatedAt;
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
