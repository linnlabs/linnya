#!/usr/bin/env node

/**
 * @file scripts/build/prepare-extra-resources.cjs
 *
 * 构建前整理随包二进制资源。
 *
 * 中文说明：
 * - Squirrel.Mac/ShipIt 安装新版 app 时会尝试处理 quarantine/xattr；
 * - 如果随包二进制资源带着异常扩展属性或权限不对，自动更新会在安装阶段失败；
 * - 这里只处理真正需要执行权限的文件，避免把配置文件、字体配置等数据文件全部 chmod 成可执行。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');

const staticResourceDirectories = [
  path.join(rootDir, 'extraResources/bin/qdrant/mac-arm64'),
];

const defaultPluginResourceRoot = path.join(rootDir, 'extraResources/plugins');

const executableFiles = new Set([
  path.join(rootDir, 'extraResources/bin/qdrant/mac-arm64/qdrant'),
]);

function exists(filePath) {
  return fs.existsSync(filePath);
}

function clearExtendedAttributes(targetPath) {
  if (process.platform !== 'darwin' || !exists(targetPath)) return;

  const result = spawnSync('xattr', ['-cr', targetPath], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.error) {
    console.warn(`[prepare-extra-resources] xattr 不可用，跳过扩展属性清理: ${targetPath}`);
    return;
  }

  if (result.status !== 0) {
    const reason = result.stderr || result.stdout || `exit=${result.status}`;
    throw new Error(`清理扩展属性失败: ${targetPath}\n${reason}`);
  }
}

function applyMode(filePath, mode) {
  fs.chmodSync(filePath, mode);
}

function normalizeModes(targetPath) {
  if (!exists(targetPath)) return;

  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return;

  if (stat.isDirectory()) {
    applyMode(targetPath, 0o755);
    for (const entry of fs.readdirSync(targetPath)) {
      normalizeModes(path.join(targetPath, entry));
    }
    return;
  }

  if (!stat.isFile()) return;

  applyMode(targetPath, executableFiles.has(targetPath) ? 0o755 : 0o644);
}

function assertFile(filePath, label = '文件') {
  if (!exists(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`缺少插件预置${label}: ${filePath}`);
  }
}

function assertDirectory(directory, label = '目录') {
  if (!exists(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`缺少插件预置${label}: ${directory}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePluginRelativePath(pluginId, rawPath, label) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(`${pluginId} 插件 manifest 缺少 ${label}`);
  }

  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${pluginId} 插件 manifest ${label} 必须位于插件包内: ${rawPath}`);
  }

  return normalized;
}

function readPluginManifestAssetPaths(pluginId, manifest) {
  const assets = [];

  if (manifest.screenshots !== undefined) {
    if (!Array.isArray(manifest.screenshots)) {
      throw new Error(`${pluginId} 插件 manifest screenshots 必须是路径数组`);
    }
    for (let index = 0; index < manifest.screenshots.length; index += 1) {
      assets.push(
        normalizePluginRelativePath(pluginId, manifest.screenshots[index], `screenshots[${index}]`)
      );
    }
  }

  return Array.from(new Set(assets));
}

function readPluginRuntimeEntryPaths(pluginId, manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !manifest.entry ||
    typeof manifest.entry !== 'object'
  ) {
    throw new Error(`${pluginId} 插件 manifest entry 必须是对象`);
  }

  const entries = [];
  for (const [entryName, rawPath] of Object.entries(manifest.entry)) {
    const entryPath = normalizePluginRelativePath(pluginId, rawPath, `entry.${entryName}`);
    if (!entryPath.startsWith('dist/')) {
      throw new Error(`${pluginId} 插件 runtime entry 必须位于 dist/ 内: ${entryPath}`);
    }
    entries.push(entryPath);
  }
  if (entries.length === 0) {
    throw new Error(`${pluginId} 插件 manifest entry 必须声明至少一个入口`);
  }
  return entries;
}

function copyPluginManifestAsset(pluginId, packageDir, targetDir, assetPath) {
  const relativeSegments = assetPath.split('/');
  const sourcePath = path.join(packageDir, ...relativeSegments);
  const targetPath = path.join(targetDir, ...relativeSegments);

  assertFile(sourcePath, `${pluginId} 资源文件`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyPluginRuntimeDist(pluginId, packageDir, targetDir, productionDistDirectories) {
  for (const directory of productionDistDirectories) {
    const sourcePath = path.join(packageDir, ...directory.split('/'));
    const targetPath = path.join(targetDir, ...directory.split('/'));
    assertDirectory(sourcePath, `${pluginId} 生产 dist 目录`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      dereference: true,
    });
  }
}

function copyPluginResources(packageDir, targetDir) {
  const resourcesDir = path.join(packageDir, 'resources');
  if (!exists(resourcesDir)) return;

  const targetResourcesDir = path.join(targetDir, 'resources');
  fs.cpSync(resourcesDir, targetResourcesDir, {
    recursive: true,
    dereference: true,
  });
}

function assertPluginResourcesForManifest(pluginId, packageDir, manifest) {
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) return;
  assertDirectory(
    path.join(packageDir, 'resources', 'skills'),
    `${pluginId} skills resources 目录`
  );
}

function copyPluginBundle(
  pluginId,
  packageDir,
  pluginResourceRoot,
  resolveProductionDistDirectories
) {
  const distDir = path.join(packageDir, 'dist');
  const targetDir = path.join(pluginResourceRoot, pluginId);
  const manifestPath = path.join(packageDir, 'plugin.json');
  const manifest = readJson(manifestPath);
  if (manifest.id !== pluginId) {
    throw new Error(`请求预置插件 ${pluginId}，但 manifest id=${manifest.id}`);
  }
  const manifestAssetPaths = readPluginManifestAssetPaths(pluginId, manifest);
  const runtimeEntryPaths = readPluginRuntimeEntryPaths(pluginId, manifest);
  const productionDistDirectories = resolveProductionDistDirectories(pluginId, manifest.entry);

  assertFile(manifestPath, `${pluginId} plugin.json`);
  assertPluginResourcesForManifest(pluginId, packageDir, manifest);
  assertFile(path.join(distDir, 'SHA512SUMS'), `${pluginId} SHA512SUMS`);

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(manifestPath, path.join(targetDir, 'plugin.json'));
  fs.copyFileSync(path.join(distDir, 'SHA512SUMS'), path.join(targetDir, 'SHA512SUMS'));
  for (const assetPath of manifestAssetPaths) {
    copyPluginManifestAsset(pluginId, packageDir, targetDir, assetPath);
  }
  copyPluginRuntimeDist(pluginId, packageDir, targetDir, productionDistDirectories);
  copyPluginResources(packageDir, targetDir);

  for (const entryPath of runtimeEntryPaths) {
    assertFile(path.join(targetDir, ...entryPath.split('/')), `${pluginId} runtime entry`);
  }

  console.log(`[prepare-extra-resources] ${pluginId} 插件预置目录已生成: ${targetDir}`);
  return targetDir;
}

function hasSamePluginIdSet(pluginIds, expectedPluginIds) {
  if (pluginIds.length !== expectedPluginIds.length) return false;
  const expected = new Set(expectedPluginIds);
  return pluginIds.every(pluginId => expected.has(pluginId));
}

async function main() {
  const { listOfficialPluginReleaseTargetIds, readPluginIdsFromCliOrEnv } = await import(
    '../release/plugin-release-targets.mjs'
  );
  const officialPluginIds = listOfficialPluginReleaseTargetIds();
  const pluginIds = readPluginIdsFromCliOrEnv({
    defaultIds: officialPluginIds,
  });
  await preparePluginBundles({
    pluginIds,
    pluginResourceRoot: defaultPluginResourceRoot,
    resetRoot: hasSamePluginIdSet(pluginIds, officialPluginIds),
    requireExactPluginIds: hasSamePluginIdSet(pluginIds, officialPluginIds),
  });

  for (const directory of staticResourceDirectories) {
    clearExtendedAttributes(directory);
    normalizeModes(directory);
  }

  console.log('[prepare-extra-resources] extraResources 权限与扩展属性整理完成。');
}

async function preparePluginBundles({
  pluginIds,
  pluginResourceRoot,
  resetRoot,
  requireExactPluginIds,
}) {
  const { resolvePluginPackageDir, resolvePluginProductionDistDirectories } = await import(
    '../release/plugin-release-targets.mjs'
  );
  const { assertBundledPluginRootMatchesPluginIds } = await import(
    '../release/functions/pluginBundledRootContract.mjs'
  );

  if (resetRoot) {
    fs.rmSync(pluginResourceRoot, { recursive: true, force: true });
  }

  const generatedResourceDirectories = pluginIds.map(pluginId =>
    copyPluginBundle(
      pluginId,
      resolvePluginPackageDir(pluginId),
      pluginResourceRoot,
      resolvePluginProductionDistDirectories
    )
  );

  if (requireExactPluginIds) {
    assertBundledPluginRootMatchesPluginIds({
      bundledPluginRoot: pluginResourceRoot,
      expectedPluginIds: pluginIds,
    });
  }

  for (const directory of generatedResourceDirectories) {
    clearExtendedAttributes(directory);
    normalizeModes(directory);
  }

  return generatedResourceDirectories;
}

module.exports = { preparePluginBundles };

if (require.main === module) {
  main().catch(error => {
    console.error('[prepare-extra-resources] failed:', error);
    process.exitCode = 1;
  });
}
