import type {
  PluginRemoteCatalogAvailability,
  PluginRemoteCatalogItem,
  PluginRuntimeArchitecture,
  PluginRuntimePlatform,
  SignedPluginCatalogEntry,
} from '@app/schemas';

import { compareDottedVersions } from '../../functions/comparePluginVersions';
import type { VerifiedPluginCatalog } from '../definitions/pluginCatalog';
import { selectCatalogPluginRelease } from './selectCatalogPluginRelease';

export const runtimeKey = (id: string, version: string): string => `${id}@${version}`;

function presentation(entry: SignedPluginCatalogEntry): Omit<PluginRemoteCatalogItem, 'availability'> {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    developer: entry.developer,
    version: entry.version,
    ...(entry.permissions ? { permissions: entry.permissions } : {}),
  };
}

/**
 * 把已验签 catalog 投影为商店条目：每个插件取本 Host 可安装的最高版本；都不可装时展示最高版本与原因。
 * 下载与磁盘占用只计入本机尚未安装的运行时，与安装时的下载计划一致。
 */
export function buildPluginRemoteCatalogView(input: {
  readonly catalog: VerifiedPluginCatalog;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly platform: PluginRuntimePlatform;
  readonly architecture: PluginRuntimeArchitecture;
  /** `runtimeKey(id, version)` 集合：已安装且复核通过的运行时。 */
  readonly installedRuntimes: ReadonlySet<string>;
}): PluginRemoteCatalogItem[] {
  const pluginIds = [...new Set(input.catalog.plugins.map(entry => entry.id))];
  return pluginIds.map(pluginId => {
    const selection = selectCatalogPluginRelease({ ...input, pluginId });
    if (selection.status === 'selected') {
      const runtimes = selection.runtimes.map(runtime => ({
        id: runtime.id,
        version: runtime.version,
        downloadBytes: runtime.target.size,
        unpackedBytes: runtime.target.unpackedSize,
        installed: input.installedRuntimes.has(runtimeKey(runtime.id, runtime.version)),
      }));
      const pending = runtimes.filter(runtime => !runtime.installed);
      return {
        ...presentation(selection.entry),
        availability: {
          status: 'installable',
          downloadBytes: selection.entry.size + pending.reduce((sum, runtime) => sum + runtime.downloadBytes, 0),
          unpackedBytes: selection.entry.unpackedSize + pending.reduce((sum, runtime) => sum + runtime.unpackedBytes, 0),
          runtimes,
        },
      };
    }
    // not-listed 不会出现：pluginId 取自 catalog 本身。
    const latestVersion = selection.status === 'not-listed' ? null : selection.latestVersion;
    const latest = input.catalog.plugins.find(entry => entry.id === pluginId && entry.version === latestVersion)
      ?? input.catalog.plugins.find(entry => entry.id === pluginId)!;
    let availability: PluginRemoteCatalogAvailability;
    if (selection.status === 'runtime-unavailable') {
      availability = { status: 'unsupported-platform' };
    } else if (latest.minApp && (compareDottedVersions(input.appVersion, latest.minApp) ?? 0) < 0) {
      availability = { status: 'requires-app-update', minApp: latest.minApp };
    } else {
      availability = { status: 'incompatible' };
    }
    return { ...presentation(latest), availability };
  });
}
