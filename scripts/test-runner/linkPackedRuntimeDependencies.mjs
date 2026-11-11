import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** 只让 tarball 看到声明的运行依赖，避免开发依赖掩盖漏打包的引用。 */
export function linkPackedRuntimeDependencies(sourcePackageRoot, packedPackageRoot, manifest) {
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const name of Object.keys(dependencies)) {
    const installedDependency = path.join(sourcePackageRoot, 'node_modules', name);
    assert.ok(existsSync(installedDependency), `tarball smoke 的运行依赖未安装：${name}`);
    const packedDependency = path.join(packedPackageRoot, 'node_modules', name);
    mkdirSync(path.dirname(packedDependency), { recursive: true });
    symlinkSync(
      installedDependency,
      packedDependency,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}
