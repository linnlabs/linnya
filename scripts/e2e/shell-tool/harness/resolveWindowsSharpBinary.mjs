import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** sharp.node 的公开入口现在是 CJS loader；PE 验收须读取包内唯一的原生制品。 */
export async function resolveWindowsSharpBinary(moduleRoot) {
  const require = createRequire(path.join(moduleRoot, 'package.json'));
  const packageRoot = path.dirname(require.resolve('@img/sharp-win32-x64/package'));
  const binaryDirectory = path.join(packageRoot, 'lib');
  const binaries = (await readdir(binaryDirectory)).filter(name => name.endsWith('.node'));
  assert.equal(binaries.length, 1, 'Windows Sharp package must contain exactly one native binary');
  return path.join(binaryDirectory, binaries[0]);
}
