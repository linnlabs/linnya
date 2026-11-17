import { listGitFiles } from './listGitFiles.mjs';

/** 当前工作区的自有文件：包括未忽略的新文件，排除 Git index 中仍登记但已删除的路径。 */
export function listWorkingTreePaths(): string[] {
  const deleted = new Set(listGitFiles(['--deleted']));
  return [...new Set(listGitFiles(['--cached', '--others', '--exclude-standard']))]
    .filter(file => !deleted.has(file))
    .sort();
}
