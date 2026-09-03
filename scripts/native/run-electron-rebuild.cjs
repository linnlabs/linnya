#!/usr/bin/env node

/**
 * 通过 @electron/rebuild 的公共 API 重建指定原生模块。
 *
 * 这里是仓库唯一的 electron-rebuild 调用入口，避免构建脚本依赖包内的 CLI 路径。
 * 调用方必须明确给出模块名；生产依赖不能因为重建失败而被静默跳过。
 */

const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const electronVersion = require('electron/package.json').version;
const moduleNames = process.argv.slice(2);

if (moduleNames.length === 0) {
  throw new Error('[electron-rebuild] 至少需要一个原生模块名。');
}

async function main() {
  const { rebuild } = await import('@electron/rebuild');
  let foundModules = [];
  const result = rebuild({
    buildPath: rootDir,
    projectRootPath: rootDir,
    electronVersion,
    platform: process.platform,
    arch: process.arch,
    onlyModules: moduleNames,
    force: true,
    types: ['prod', 'optional'],
  });

  result.lifecycle.on('modules-found', (modules) => {
    foundModules = modules;
    console.log(`[electron-rebuild] Electron ${electronVersion} / ${process.platform}/${process.arch}`);
    console.log(`[electron-rebuild] 重建模块：${modules.join(', ')}`);
  });

  await result;
  if (foundModules.length === 0) {
    throw new Error(`[electron-rebuild] 没有找到目标模块：${moduleNames.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('[electron-rebuild] 重建失败。');
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
