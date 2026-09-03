import path from 'node:path';
import { parsePluginManifest } from '@app/schemas';

import type { PluginUpgradePlan } from '../../../features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import type { PluginUpgradePlanResolveInput } from '../../../features/plugins/install/orchestration/installPluginFromRemoteAndActivate';
import { loadBackendPluginsFromDisk } from '../loader/diskPluginLoader';
import { readJsonFile } from '../loader/pluginLayout';

export function resolveDiskPluginUpgradePlan(input: PluginUpgradePlanResolveInput): PluginUpgradePlan {
  const manifest = parsePluginManifest(readJsonFile(path.join(input.pluginDir, 'plugin.json')));
  if (manifest.id !== input.pluginId || manifest.version !== input.version) {
    throw new Error(
      `插件 manifest 与安装目标不一致: expected=${input.pluginId}@${input.version}, actual=${manifest.id}@${manifest.version}`,
    );
  }

  const loaded = loadBackendPluginsFromDisk({
    directPluginDirs: [input.pluginDir],
    appVersion: input.appVersion,
  });
  const backendPlugin = loaded.find((item) => item.contribution.meta.id === input.pluginId);
  if (!backendPlugin) {
    if (manifest.entry.backend) {
      throw new Error(`无法加载插件 backend，不能安全执行安装迁移: ${input.pluginId}@${input.version}`);
    }
    return {
      pluginId: manifest.id,
      targetVersion: manifest.version,
      compatMin: manifest.compat?.minApp,
      ownedTables: [],
      migrations: [],
    };
  }

  return {
    pluginId: backendPlugin.contribution.meta.id,
    targetVersion: backendPlugin.contribution.meta.version,
    compatMin: backendPlugin.contribution.meta.compatMin,
    ownedTables: backendPlugin.contribution.ownedTables ?? [],
    migrations: backendPlugin.contribution.pluginMigrations ?? [],
  };
}
