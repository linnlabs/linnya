import { execFileSync, execSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
const checkout = realpathSync(path.resolve(packageRoot, '../..'));
const shareBuild = process.env.LINNYA_CI_ARTIFACT_CHECKOUT === checkout;
// 全量 CI 为每轮创建独立的外层目录，并串行调度写 dist 的步骤。回执也随检出一起回收。
const receipt = path.join(path.dirname(checkout), 'schemas-runtime-built');
const options = { cwd: packageRoot, stdio: 'inherit' };

if (shareBuild && existsSync(receipt)) {
  // 每个消费者仍核对全部公开入口并实际加载 CJS 和 ESM。损坏的产物会在这里报错。
  execFileSync(process.execPath, ['scripts/verify-runtime-exports.cjs'], options);
  console.log('[schemas] reused compiled runtime in this checkout');
} else {
  execSync('pnpm run build', options);
  if (shareBuild) writeFileSync(receipt, '');
}
