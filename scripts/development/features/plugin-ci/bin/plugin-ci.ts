import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pluginOwnerCommands } from '../definitions/pluginCiGates.ts';
import { selectPluginCiScope } from '../functions/selectPluginCiScope.ts';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: 'origin/main' },
  list: { type: 'boolean' },
  owner: { type: 'string' },
  'pr-owner': { type: 'string' },
} });
const root = realpathSync(process.cwd());
function run(args: readonly string[]): void {
  console.log(`\n$ pnpm ${args.join(' ')}`);
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

if (values.owner !== undefined && values['pr-owner'] !== undefined) throw new Error('--owner 和 --pr-owner 只能选一个');
const owner = values['pr-owner'] ?? values.owner;
if (owner !== undefined) {
  // 只有同时要求 public 任务成功的 PR 入口才把静态检查交给它。
  const mode = values['pr-owner'] === undefined ? 'local' : 'pull-request';
  for (const args of pluginOwnerCommands(owner, mode)) run(args);
} else {
  const plan = selectPluginCiScope(root, values.base);
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${plan.scope}\njobs=${JSON.stringify(plan.jobs)}\n`);
  if (!values.list) {
    if (plan.scope !== 'full') {
      for (const args of pluginOwnerCommands(plan.scope)) run(args);
    }
    if (plan.scope === 'full' || plan.regression) {
      const filter = plan.regression ? ['--workflow', plan.regression] : [];
      run(['run', 'ci:local', '--working-copy', ...filter]);
    }
  }
}
