import { productionRuntimeDependencyNames } from '../definitions/productionRuntimeDependencies.mjs';

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
 * dist_build 不是 pnpm workspace，由 npm 按这份清单装出扁平的生产 node_modules。
 * 清单只保留成品在运行时要从 node_modules 加载的根依赖；已经打进 bundle 的包和 workspace
 * 本地包都不进入，所以不会把 workspace:* 交给 npm 猜测。
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
  projected.dependencies = Object.fromEntries(productionRuntimeDependencyNames.map(packageName => {
    const range = sourceManifest.dependencies[packageName];
    if (typeof range !== 'string') {
      throw new Error(`生产 package 投影需要根 dependencies 声明 ${packageName}`);
    }
    return [packageName, range];
  }));
  // electron-builder 通过应用 manifest 确定 runtime 版本；其他构建工具不属于发布树。
  projected.devDependencies = { electron: electronVersion };

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

/** Desktop 携带 schemas 已编译的 dist；npm 不应再解析这个本地包的构建与测试工具。 */
export function projectPackagedSchemasManifest(sourceManifest) {
  return Object.fromEntries(Object.entries(sourceManifest).filter(
    ([field]) => field !== 'scripts' && field !== 'devDependencies'
  ));
}
