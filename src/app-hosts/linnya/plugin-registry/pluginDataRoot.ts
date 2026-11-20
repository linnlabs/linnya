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
  const knownLegacyRoots: string[] = [];
  for (const [candidateId, candidateDirectory] of registeredBackendPluginDirectories) {
    if (candidateId === pluginId) continue;
    try {
      const candidateManifest = parsePluginManifest(readJsonFile(path.join(candidateDirectory, 'plugin.json')));
      for (const legacyRoot of candidateManifest.dataStorage.legacyRoots) {
        if (knownLegacyRoots.includes(legacyRoot)) {
          throw new Error(`插件旧数据根被多个插件声明: ${legacyRoot}`);
        }
        knownLegacyRoots.push(legacyRoot);
      }
    } catch (error) {
      throw new Error(`读取插件 ${candidateId} 的旧数据根声明失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return resolvePluginDataRoot({
    workspaceRoot,
    pluginId,
    dataStorage: manifest.dataStorage,
    allowLegacyRoots: true,
    knownLegacyRoots: [...ownLegacyRoots, ...knownLegacyRoots],
  });
}

export function resolvePluginDataRootForManifest(options: {
  readonly pluginId: PluginId;
  readonly dataStorage: PluginManifestDataStorage;
  readonly allowLegacyRoots?: boolean;
  readonly knownLegacyRoots?: readonly string[];
}): string {
  return resolvePluginDataRoot({
    workspaceRoot: pathManager.getWorkspaceRoot(),
    pluginId: options.pluginId,
    dataStorage: options.dataStorage,
    allowLegacyRoots: options.allowLegacyRoots,
    knownLegacyRoots: options.knownLegacyRoots,
  });
}
