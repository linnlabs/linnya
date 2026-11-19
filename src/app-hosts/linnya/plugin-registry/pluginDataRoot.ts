import path from 'node:path';
import { parsePluginManifest, type PluginId, type PluginManifestDataStorage } from '@app/schemas';
import { pathManager } from '../../../shared/utils/pathManager';
import { getRegisteredBackendPluginDirectory, registeredBackendPluginDirectories } from './registeredPluginDirectories';
import { readJsonFile } from '../../../electron-main/plugins/loader/pluginLayout';
import { resolvePluginDataRoot } from '../../../features/plugins/infrastructure/cleanup/pluginDataRoot';

export function resolveRegisteredPluginDataRoot(pluginId: PluginId): string {
  const directory = getRegisteredBackendPluginDirectory(pluginId);
  if (!directory) throw new Error(`插件未注册，不能解析数据根: ${pluginId}`);
  const manifest = parsePluginManifest(readJsonFile(path.join(directory, 'plugin.json')));
  const workspaceRoot = pathManager.getWorkspaceRoot();
  const ownLegacyRoots = new Set(
    manifest.dataStorage.legacyRoots.map(legacyRoot => path.resolve(workspaceRoot, legacyRoot)),
  );
  for (const [candidateId, candidateDirectory] of registeredBackendPluginDirectories) {
    if (candidateId === pluginId) continue;
    try {
      const candidateManifest = parsePluginManifest(readJsonFile(path.join(candidateDirectory, 'plugin.json')));
      for (const legacyRoot of candidateManifest.dataStorage.legacyRoots) {
        const candidateRoot = path.resolve(workspaceRoot, legacyRoot);
        if (ownLegacyRoots.has(candidateRoot)) {
          throw new Error(`插件旧数据根被多个插件声明: ${legacyRoot}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('插件旧数据根被多个插件声明')) throw error;
    }
  }
  return resolvePluginDataRoot({
    workspaceRoot,
    pluginId,
    dataStorage: manifest.dataStorage,
  });
}

export function resolvePluginDataRootForManifest(options: {
  readonly pluginId: PluginId;
  readonly dataStorage: PluginManifestDataStorage;
}): string {
  return resolvePluginDataRoot({
    workspaceRoot: pathManager.getWorkspaceRoot(),
    pluginId: options.pluginId,
    dataStorage: options.dataStorage,
  });
}
