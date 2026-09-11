import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readDiskBackendLoadingMode(packageJson, packageDir) {
  const linnya = packageJson.linnya;
  if (linnya === undefined) return null;
  if (!linnya || typeof linnya !== 'object' || Array.isArray(linnya)) {
    throw new Error(`${packageDir}/package.json: linnya 必须是对象`);
  }

  const development = linnya.development;
  if (development === undefined) return null;
  if (!development || typeof development !== 'object' || Array.isArray(development)) {
    throw new Error(`${packageDir}/package.json: linnya.development 必须是对象`);
  }

  const backendLoading = development.backendLoading;
  if (backendLoading === undefined) return null;
  if (backendLoading !== 'disk') {
    throw new Error(`${packageDir}/package.json: linnya.development.backendLoading 只允许 disk`);
  }
  return backendLoading;
}

/**
 * 发现当前本地 workspace 中明确选择磁盘 backend 开发模式的插件。
 *
 * 插件自行声明开发装配方式，Host 不维护私有插件路径或实现清单。私有插件迁到相邻
 * canonical repo 后，可改用 LINNYA_PLUGIN_BACKEND_DIRECT_DIRS 提供同一输入合同。
 */
export function discoverWorkspaceDiskBackendPlugins(repositoryRoot = process.cwd()) {
  const pluginsRoot = path.join(repositoryRoot, 'packages', 'plugins');
  if (!fs.existsSync(pluginsRoot)) return [];

  const plugins = [];
  const seenIds = new Set();
  for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(pluginsRoot, entry.name);
    const packageJsonPath = path.join(packageDir, 'package.json');
    const pluginManifestPath = path.join(packageDir, 'plugin.json');
    if (!fs.existsSync(packageJsonPath) || !fs.existsSync(pluginManifestPath)) continue;

    const packageJson = readJson(packageJsonPath);
    if (readDiskBackendLoadingMode(packageJson, packageDir) !== 'disk') continue;
    const pluginManifest = readJson(pluginManifestPath);
    const pluginId = typeof pluginManifest.id === 'string' ? pluginManifest.id.trim() : '';
    if (!pluginId) {
      throw new Error(`${pluginManifestPath}: id 必须是非空字符串`);
    }
    if (seenIds.has(pluginId)) {
      throw new Error(`开发态磁盘 backend 插件 ID 重复: ${pluginId}`);
    }
    seenIds.add(pluginId);
    const backendWatchConfig = packageJson.linnya.development.backendWatchConfig;
    if (typeof backendWatchConfig !== 'string' || !backendWatchConfig.trim() || path.isAbsolute(backendWatchConfig)
      || backendWatchConfig.split(/[\\/]/).includes('..')) {
      throw new Error(`${packageJsonPath}: backendWatchConfig 必须是包内相对配置路径`);
    }
    plugins.push(Object.freeze({ pluginId, packageDir, backendWatchConfig }));
  }

  return plugins.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}
