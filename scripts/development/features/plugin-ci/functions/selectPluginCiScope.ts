import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pluginCiTargets } from '../definitions/pluginCiGates.ts';

/** 用锁定版本的 pnpm 读取 workspace 及其反向依赖，选择器不维护第二张包图。 */
function workspacePackages(root: string, filters: readonly string[]) {
  const raw: unknown = JSON.parse(execFileSync('pnpm', [
    '-r', ...filters.flatMap(filter => ['--filter', filter]), 'list', '--depth=-1', '--json',
  ], { cwd: root, encoding: 'utf8' }));
  if (!Array.isArray(raw)) throw new Error('无法读取 pnpm workspace');
  return raw.map((row: unknown) => {
    if (typeof row !== 'object' || !row || !('name' in row) || typeof row.name !== 'string'
      || !('path' in row) || typeof row.path !== 'string') throw new Error('pnpm workspace 缺少包名或路径');
    return { name: row.name, directory: path.relative(root, row.path).split(path.sep).join('/') };
  });
}

export function selectPluginCiScope(root: string, baseRef: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const base = git('merge-base', '--', baseRef, 'HEAD').trim();
  // 比较实际要测试的工作副本。禁用 rename 折叠，否则从公共目录移入插件会丢掉被删除的一侧。
  const paths = new Set([
    ...git('diff', '--no-renames', '--name-only', '-z', base, '--').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
  ]);
  paths.delete('');
  const packages = workspacePackages(root, []).sort((a, b) => b.directory.length - a.directory.length);
  const changed = new Set<string>();
  for (const file of paths) {
    const owner = packages.find(pkg => !pkg.directory || file.startsWith(`${pkg.directory}/`));
    if (owner) changed.add(owner.name);
  }
  const affected = changed.size ? workspacePackages(root, [...changed].map(name => `...${name}`)).map(pkg => pkg.name).sort() : [];
  const files = [...paths].sort();
  const plugin = [...pluginCiTargets.keys()].find(id => files.length > 0 && files.every(file =>
    file.startsWith(`packages/plugins/${id}/src/`) || file.startsWith(`packages/plugins/${id}/resources/`)));
  const scoped = plugin && affected.length === 1 && affected[0] === `@plugin/${plugin}`;
  const scope = scoped ? plugin : 'full';
  const regression = pluginCiTargets.get(scope)?.regressionWorkflow;
  const jobs = scope === 'full' ? ['public', 'platform', 'canvas-regression'] : ['public', 'owner'];
  if (regression) jobs.push(regression);
  const reason = scoped ? '改动仅涉及该插件的源码或资源，包图中没有其他消费者'
    : !paths.size ? '比较范围为空，执行全量' : '改动涉及插件专属源码与资源以外的范围，或存在其他消费者';
  return { base, scope, jobs, regression, reason, files, affectedPackages: affected };
}
