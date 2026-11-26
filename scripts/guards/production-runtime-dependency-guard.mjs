import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dynamicallyLoadedProductionDependencies,
  productionImportsResolvedElsewhere,
  staticallyLoadedProductionDependencies,
} from '../build/definitions/productionRuntimeDependencies.mjs';
import { findRuntimePackageImports } from '../build/functions/findRuntimePackageImports.mjs';

/**
 * 在 dist_build 装完生产依赖之后、electron-builder 之前运行：
 * 用成品里的 Node 侧脚本核对生产安装清单，漏登记和多登记都失败。
 * 只看 dist_build 自己的 node_modules，不看仓库根的开发依赖，否则漏包会被开发树掩盖。
 */
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distBuildRoot = path.join(repositoryRoot, 'dist_build');
const installedRoot = path.join(distBuildRoot, 'node_modules');

// 每个扫描根就是安装后的一棵独立目录；脚本向上找自带 node_modules 时不能越过它。
const scanRoots = [
  path.join(distBuildRoot, 'dist'),
  path.join(repositoryRoot, 'extraResources', 'plugins'),
];
// 安装包里的主进程只有字节码，改扫同一次构建留在仓库 dist 里的源 bundle。
const mainBundle = path.join(repositoryRoot, 'dist', 'main', 'main.cjs');

function listNodeScripts(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // renderer 是浏览器 bundle；插件自带的 node_modules 由插件自己负责。
      if (entry.name !== 'node_modules' && entry.name !== 'renderer') listNodeScripts(entryPath, output);
    } else if (/\.(?:cjs|js|mjs)$/u.test(entry.name)) {
      output.push(entryPath);
    }
  }
  return output;
}

function resolvesInsideScanRoot(filePath, scanRoot, packageName) {
  for (let directory = path.dirname(filePath); ; directory = path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, 'node_modules', packageName, 'package.json'))) return true;
    if (directory === scanRoot) return false;
  }
}

if (!fs.existsSync(installedRoot)) {
  throw new Error(`生产依赖门禁需要先在 dist_build 安装生产依赖：${installedRoot}`);
}
const importers = new Map();
const record = (packageName, filePath) => {
  const files = importers.get(packageName) ?? [];
  files.push(path.relative(repositoryRoot, filePath));
  importers.set(packageName, files);
};
for (const scanRoot of scanRoots) {
  for (const filePath of listNodeScripts(scanRoot)) {
    for (const packageName of await findRuntimePackageImports(filePath)) {
      if (!resolvesInsideScanRoot(filePath, scanRoot, packageName)) record(packageName, filePath);
    }
  }
}
for (const packageName of await findRuntimePackageImports(mainBundle)) record(packageName, mainBundle);

const declaredStatic = new Set(staticallyLoadedProductionDependencies);
const declaredDynamic = new Set(Object.keys(dynamicallyLoadedProductionDependencies));
const resolvedElsewhere = new Set(Object.keys(productionImportsResolvedElsewhere));
const isInstalled = packageName => fs.existsSync(path.join(installedRoot, packageName, 'package.json'));
const failures = [];
for (const [packageName, files] of [...importers].sort(([left], [right]) => left.localeCompare(right))) {
  if (declaredStatic.has(packageName) || resolvedElsewhere.has(packageName)) continue;
  const sample = files.slice(0, 3).join('、');
  failures.push(declaredDynamic.has(packageName)
    ? `${packageName} 在成品里有静态引用（${sample}），应登记到 staticallyLoadedProductionDependencies`
    : isInstalled(packageName)
      ? `${packageName} 被成品引用（${sample}）但没有登记，现在只是作为别的包的传递依赖碰巧装上`
      : `${packageName} 被成品引用（${sample}）但安装包里没有；不能内联就登记为运行时依赖，本来就不从安装包解析则登记到 productionImportsResolvedElsewhere`);
}
for (const packageName of declaredStatic) {
  if (!importers.has(packageName)) failures.push(`${packageName} 已登记为运行时依赖，但成品里没有脚本引用它，应从名单移除`);
}
for (const packageName of [...declaredStatic, ...declaredDynamic]) {
  if (!isInstalled(packageName)) failures.push(`${packageName} 已登记为运行时依赖，但 dist_build/node_modules 里没有`);
}
for (const packageName of resolvedElsewhere) {
  if (!importers.has(packageName)) failures.push(`${packageName} 登记为“不从安装包解析”，但成品里已经没有引用，应移除这条登记`);
}
if (failures.length > 0) {
  throw new Error(`生产运行时依赖名单与成品不一致：\n- ${failures.join('\n- ')}`);
}
console.log(`[production-runtime-dependency-guard] 成品引用的 ${importers.size} 个外部包与生产安装清单一致。`);
