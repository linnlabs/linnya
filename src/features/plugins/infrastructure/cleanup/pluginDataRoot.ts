import fs from 'node:fs';
import path from 'node:path';
import type { PluginId, PluginManifestDataStorage } from '@app/schemas';

/**
 * Resolve a plugin's data root without teaching Host about a plugin's business
 * directory. New plugins live below `Plugins/<id>`; an old top-level directory
 * is used only when the plugin manifest explicitly declares it and it exists.
 */
export function resolvePluginDataRoot(options: {
  readonly workspaceRoot: string;
  readonly pluginId: PluginId;
  readonly dataStorage: PluginManifestDataStorage;
}): string {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const pluginId = options.pluginId.trim();
  if (!pluginId || pluginId === '.' || pluginId === '..' || pluginId.includes('/') || pluginId.includes('\\')) {
    throw new Error(`插件 ID 不能作为数据目录名: ${options.pluginId}`);
  }

  const defaultRoot = path.join(workspaceRoot, 'Plugins', pluginId);
  const existingLegacyRoots: string[] = [];
  for (const legacyRoot of options.dataStorage.legacyRoots) {
    const candidate = resolveWorkspaceRelative(workspaceRoot, legacyRoot);
    if (fs.existsSync(candidate)) existingLegacyRoots.push(candidate);
  }
  if (existingLegacyRoots.length > 1) {
    throw new Error(`插件数据根存在多个旧位置: ${pluginId}`);
  }
  if (existingLegacyRoots.length === 1) {
    const legacyRoot = existingLegacyRoots[0];
    if (!fs.existsSync(defaultRoot)) return legacyRoot;
    const legacyHasFiles = directoryHasFiles(legacyRoot);
    const defaultHasFiles = directoryHasFiles(defaultRoot);
    if (legacyHasFiles && !defaultHasFiles) return legacyRoot;
    if (!legacyHasFiles && defaultHasFiles) return defaultRoot;
    if (!legacyHasFiles && !defaultHasFiles) return legacyRoot;
    throw new Error(`插件数据根存在多个候选位置: ${pluginId}`);
  }

  return defaultRoot;
}
function directoryHasFiles(directory: string): boolean {
  return fs.readdirSync(directory, { withFileTypes: true }).some(entry => {
    if (!entry.isDirectory()) return true;
    return directoryHasFiles(path.join(directory, entry.name));
  });
}

function resolveWorkspaceRelative(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`插件旧数据根声明非法: ${relativePath}`);
  }
  const resolved = path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件旧数据根不能越出 Workspace: ${relativePath}`);
  }
  return resolved;
}
