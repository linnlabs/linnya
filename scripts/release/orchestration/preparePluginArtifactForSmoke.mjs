import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 两套 smoke 始终分别运行；只在 CI 的同一份临时检出内共享一次已成功的打包。 */
export function preparePluginArtifactForSmoke({ packageDir, repoRoot, build }) {
  if (process.env.LINNYA_CI_ARTIFACT_CHECKOUT !== repoRoot || !packageDir.startsWith(`${repoRoot}${path.sep}`)) {
    build();
    return;
  }
  const owner = path.relative(repoRoot, packageDir);
  // 回执在本轮临时目录里，按实际 package 路径区分，不进入发行产物。
  const receipt = path.join(path.dirname(repoRoot), `prepared-${encodeURIComponent(owner)}.sha512`);
  const digest = () => JSON.parse(readFileSync(path.join(packageDir, 'dist/artifacts/latest.json'), 'utf8')).sha512;
  if (existsSync(receipt)) {
    const expected = readFileSync(receipt, 'utf8');
    if (!expected) throw new Error(`${owner} package:artifact did not finish successfully in this run`);
    if (digest() !== expected) throw new Error(`${owner} artifact changed after packaging`);
    console.log(`[artifact-smoke] reused ${owner} sha512=${expected}`);
    return;
  }
  // 包的末尾还有大小与内容门禁。打包中止时留下空凭据，后续验收也报失败。
  writeFileSync(receipt, '');
  build();
  const sha512 = digest();
  writeFileSync(receipt, sha512);
  console.log(`[artifact-smoke] prepared ${owner} sha512=${sha512}`);
}
