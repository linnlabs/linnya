interface ProjectExpansionRetentionInput {
  isLoadingProjects: boolean;
  projectIds: readonly string[];
  hasObservedLoadedProjectList: boolean;
}

/**
 * 判断当前项目列表是否已经可以用于清理持久化的展开态。
 *
 * 中文说明：
 * - Pinia 会先恢复侧栏展开态；
 * - 项目列表随后异步加载，加载前 `projects` 会短暂是空数组；
 * - 这个空数组不是“所有项目都被删除”，不能拿来清理刚恢复出来的展开态。
 */
export function shouldRetainExpandedProjects(input: ProjectExpansionRetentionInput): boolean {
  if (input.isLoadingProjects) return false;
  if (input.projectIds.length > 0) return true;
  return input.hasObservedLoadedProjectList;
}
