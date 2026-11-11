import { execFileSync } from 'node:child_process';

/** 当前工作区的自有文件：包括未忽略的新文件，排除 Git index 中仍登记但已删除的路径。 */
export function listWorkingTreePaths(): string[] {
  const list = (args: readonly string[]): string[] =>
    execFileSync('git', ['ls-files', '-z', ...args], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const deleted = new Set(list(['--deleted']));
  return [...new Set(list(['--cached', '--others', '--exclude-standard']))]
    .filter(file => !deleted.has(file))
    .sort();
}
