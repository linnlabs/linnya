import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pluginOwnerCommands } from '../definitions/pluginCiGates.ts';
import { selectPluginCiScope } from '../functions/selectPluginCiScope.ts';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: 'origin/main' },
  list: { type: 'boolean' },
  owner: { type: 'string' },
} });
const root = realpathSync(process.cwd());
function run(args: readonly string[]): void {
  console.log(`\n$ pnpm ${args.join(' ')}`);
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

if (values.owner !== undefined) {
  // PR 的独立 runner 接收已选中的 owner；平台矩阵由同一 PR 的可复用工作流调度。
  for (const args of pluginOwnerCommands(values.owner)) run(args);
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
