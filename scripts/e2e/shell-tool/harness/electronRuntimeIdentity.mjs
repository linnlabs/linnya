import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const packagePath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
const rootPackage = JSON.parse(await readFile(packagePath, 'utf8'));
const configuredVersion = rootPackage.devDependencies?.electron;

if (typeof configuredVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(configuredVersion)) {
  throw new Error('根 package.json 必须精确锁定 Electron patch 版本。');
}

/** Electron E2E 的唯一版本真相源。 */
export const expectedElectronVersion = configuredVersion;

export function bindElectronVersion(packageManifest) {
  if (!packageManifest.build || typeof packageManifest.build !== 'object') {
    throw new Error('Electron fixture 缺少 build 配置。');
  }
  packageManifest.build.electronVersion = expectedElectronVersion;
  return packageManifest;
}
