import type { WorkspaceNode } from '../definitions/workspaceTree';

export function flattenVisibleWorkspaceTree(
  nodes: readonly WorkspaceNode[] | null | undefined,
): WorkspaceNode[] {
  if (!nodes) return [];
  const flattened: WorkspaceNode[] = [];
  for (const node of nodes) {
    flattened.push(node);
    if (node.isExpanded) {
      flattened.push(...flattenVisibleWorkspaceTree(node.children));
    }
  }
  return flattened;
}
