import fs from 'node:fs';
import path from 'node:path';
import type { PluginId, PluginManifestDataStorage } from '@app/schemas';

import { assertPluginDataDirectory, isMissingPathError } from './pluginDataPaths';

export function resolvePluginDataRoot(options: {
  readonly workspaceRoot: string;
  readonly pluginId: PluginId;
  readonly dataStorage: PluginManifestDataStorage;
  /** 只由可信产品装配入口传入，不能来自 manifest 或旧清理任务。 */
  readonly legacyRootOwners?: ReadonlyMap<string, PluginId>;
}): string {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const { pluginId } = options;
  assertPluginDataId(pluginId);

  const defaultRoot = path.join(workspaceRoot, 'Plugins', pluginId);
  if (options.dataStorage.legacyRoots.length > 0 && !options.legacyRootOwners) {
    throw new Error(`插件来源不可信，不能接管旧数据根: ${pluginId}`);
  }
  const defaultExists = assertPluginDataDirectory(workspaceRoot, defaultRoot);
  const resolvedDeclaredLegacyRoots = [...new Set(options.dataStorage.legacyRoots)].map(legacyRoot => {
    if (options.legacyRootOwners?.get(legacyRoot) !== pluginId) {
      throw new Error(`插件旧数据根未获宿主白名单授权: ${legacyRoot}`);
    }
    return path.resolve(workspaceRoot, legacyRoot);
  });
  const existingLegacyRoots = resolvedDeclaredLegacyRoots.filter(candidate => assertPluginDataDirectory(workspaceRoot, candidate));
  if (existingLegacyRoots.length > 1) {
    throw new Error(`插件数据根存在多个旧位置: ${pluginId}`);
  }
  if (existingLegacyRoots.length === 1) {
    const legacyRoot = existingLegacyRoots[0];
    if (!defaultExists) return legacyRoot;
    const legacyHasFiles = directoryHasFiles(legacyRoot);
    const defaultHasFiles = directoryHasFiles(defaultRoot);
    if (legacyHasFiles && !defaultHasFiles) return legacyRoot;
    if (!legacyHasFiles && defaultHasFiles) return defaultRoot;
    if (!legacyHasFiles && !defaultHasFiles) return legacyRoot;
    throw new Error(`插件数据根存在多个候选位置: ${pluginId}`);
  }
  return defaultRoot;
}
export function assertPluginDataId(pluginId: string): void {
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(pluginId)) {
    throw new Error(`插件 ID 不能作为数据目录名: ${pluginId}`);
  }
}
function directoryHasFiles(directory: string): boolean {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).some(entry =>
      !entry.isDirectory() || directoryHasFiles(path.join(directory, entry.name)));
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}
