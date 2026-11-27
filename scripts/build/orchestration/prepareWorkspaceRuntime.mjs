import { execFileSync, execSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// pnpm 在对应 workspace 包目录内运行其 prepare:runtime 脚本。
const packageRoot = realpathSync(process.cwd());
const packageId = path.basename(packageRoot);
const checkout = realpathSync(path.resolve(packageRoot, '../..'));
const shareBuild = process.env.LINNYA_CI_ARTIFACT_CHECKOUT === checkout;
// 全量 CI 为每轮创建独立的外层目录，并串行调度写 dist 的步骤。回执也随检出一起回收。
const receipt = path.join(path.dirname(checkout), `${packageId}-runtime-built`);
const options = { cwd: packageRoot, stdio: 'inherit' };

if (shareBuild && existsSync(receipt)) {
  const [verifyOnReuse] = process.argv.slice(2);
  if (verifyOnReuse) execFileSync(process.execPath, [verifyOnReuse], options);
  console.log(`[${packageId}] reused compiled runtime in this checkout`);
} else {
  execSync('pnpm run build', options);
  if (shareBuild) writeFileSync(receipt, '');
}
