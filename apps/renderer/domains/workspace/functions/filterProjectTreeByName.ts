import type { WorkspaceNode } from '../store/WorkspaceTreeStore';

function normalizeTreeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function cloneNodeWithChildren(node: WorkspaceNode, children: WorkspaceNode[] | null | undefined): WorkspaceNode {
  return {
    ...node,
    children,
  };
}

function includeMatchedNode(node: WorkspaceNode): WorkspaceNode {
  if (node.type !== 'folder') return cloneNodeWithChildren(node, node.children);

  return {
    ...node,
    // 搜索命中文件夹本身时保留完整子树，避免用户点进结果后上下文突然消失。
    isExpanded: true,
  };
}

function filterNodeByName(node: WorkspaceNode, query: string): WorkspaceNode | null {
  const displayName = node.displayName ?? '';
  const nameMatches = node.name.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);

  if (nameMatches) {
    return includeMatchedNode(node);
  }

  if (!node.children || node.children.length === 0) {
    return null;
  }

  const matchedChildren = node.children
    .map(child => filterNodeByName(child, query))
    .filter((child): child is WorkspaceNode => child !== null);

  if (matchedChildren.length === 0) {
    return null;
  }

  return {
    ...node,
    isExpanded: true,
    children: matchedChildren,
  };
}

export function filterProjectTreeByName(nodes: WorkspaceNode[], query: string): WorkspaceNode[] {
  const normalizedQuery = normalizeTreeSearchQuery(query);
  if (!normalizedQuery) return nodes;

  return nodes
    .map(node => filterNodeByName(node, normalizedQuery))
    .filter((node): node is WorkspaceNode => node !== null);
}
