const bundledWorkspaceDependencyNames = Object.freeze([
  '@linnlabs/linnkit-provider-ai-sdk',
  '@linnya/provider-catalog',
  '@linnya/renderer-ui',
  'parser-wasm',
]);

const installDependencySections = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

const productionManifestKeys = Object.freeze([
  'author',
  'bugs',
  'build',
  'description',
  'engines',
  'homepage',
  'keywords',
  'license',
  'main',
  'name',
  'private',
  'productName',
  'repository',
  'type',
  'version',
  'overrides',
]);

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * dist_build 不是 pnpm workspace。生产代码已经把下列本地 package 编入 main、renderer、
 * backend 或 worker；parser-wasm 的 Node 产物则由 electron-builder files 显式携带。
 * 因此生产安装清单必须删除这些开发期解析入口，不能把 workspace:* 交给 npm 猜测。
 */
export function projectProductionPackageManifest(sourceManifest) {
  if (
    !isRecord(sourceManifest) ||
    !isRecord(sourceManifest.dependencies) ||
    !isRecord(sourceManifest.devDependencies)
  ) {
    throw new Error('生产 package 投影需要有效的 dependencies');
  }
  const electronVersion = sourceManifest.devDependencies.electron;
  if (typeof electronVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(electronVersion)) {
    throw new Error('生产 package 必须从根 devDependencies 读取精确 Electron 版本');
  }
  const projected = Object.fromEntries(
    productionManifestKeys
      .filter(key => sourceManifest[key] !== undefined)
      .map(key => [key, globalThis.structuredClone(sourceManifest[key])])
  );
  projected.dependencies = globalThis.structuredClone(sourceManifest.dependencies);
  // electron-builder 通过应用 manifest 确定 runtime 版本；其他构建工具不属于发布树。
  projected.devDependencies = { electron: electronVersion };
  for (const packageName of bundledWorkspaceDependencyNames) {
    if (projected.dependencies[packageName] !== 'workspace:*') {
      throw new Error(
        `生产 package 投影预期 ${packageName}=workspace:*，实际为 ${String(projected.dependencies[packageName])}`
      );
    }
    delete projected.dependencies[packageName];
  }

  const unresolved = [];
  for (const sectionName of installDependencySections) {
    const section = projected[sectionName];
    if (section === undefined) continue;
    if (!isRecord(section)) throw new Error(`生产 package ${sectionName} 必须是对象`);
    for (const [packageName, range] of Object.entries(section)) {
      if (typeof range !== 'string') {
        throw new Error(`生产 package ${sectionName}.${packageName} 必须是字符串`);
      }
      if (range.startsWith('workspace:')) unresolved.push(`${sectionName}.${packageName}`);
    }
  }
  if (unresolved.length > 0) {
    throw new Error(`生产 package 仍含未处置 workspace 依赖：${unresolved.join(', ')}`);
  }
  return projected;
}

export const productionBundledWorkspaceDependencyNames = bundledWorkspaceDependencyNames;
