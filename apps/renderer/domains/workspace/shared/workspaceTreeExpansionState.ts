const EXPANDED_NODES_KEY_PREFIX = 'linnya-sidebar-expanded-nodes-';

export function readExpandedWorkspaceNodeIds(projectId: string): string[] {
  if (!projectId) return [];
  try {
    const stored = localStorage.getItem(`${EXPANDED_NODES_KEY_PREFIX}${projectId}`);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch (error: unknown) {
    console.error('[workspace-tree-expansion] 读取展开状态失败:', error);
    return [];
  }
}

export function saveExpandedWorkspaceNodeIds(projectId: string, ids: ReadonlySet<string>): void {
  if (!projectId) return;
  try {
    localStorage.setItem(
      `${EXPANDED_NODES_KEY_PREFIX}${projectId}`,
      JSON.stringify(Array.from(ids)),
    );
  } catch (error: unknown) {
    console.error('[workspace-tree-expansion] 保存展开状态失败:', error);
  }
}
