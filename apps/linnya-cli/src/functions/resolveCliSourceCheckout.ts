import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readSourceCheckoutIdentity } from '../../../../src/shared/runtime-paths/functions/readSourceCheckoutIdentity';
import type { SourceCheckoutIdentity } from '../../../../src/shared/runtime-paths/definitions/sourceCheckoutIdentity';

/** 按 CLI 自身入口定位，不能把 Shell 的会话 cwd 或另一仓库当成源码身份。 */
export function resolveCliSourceCheckout(
  entryPath = process.argv[1]
): SourceCheckoutIdentity | null {
  if (!entryPath) return null;
  const entry = realpathSync.native(entryPath);
  const cliRoot = path.resolve(path.dirname(entry), '..');
  const root = path.resolve(cliRoot, '../..');
  if (
    !existsSync(path.join(cliRoot, 'src/main.ts')) ||
    !existsSync(path.join(root, 'pnpm-workspace.yaml')) ||
    path.resolve(root, 'apps/linnya-cli') !== cliRoot
  )
    return null;
  return readSourceCheckoutIdentity(root);
}
