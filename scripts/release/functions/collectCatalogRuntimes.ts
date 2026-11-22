import {
  satisfiesSemverRange,
  type PluginRuntimeEntry,
  type SignedPluginCatalogEntry,
} from '../../../packages/schemas/src/plugins/catalog.ts';
import type { RuntimeComponentMetadata } from './packageRuntimeComponent.ts';

/**
 * 把各平台打包产出的运行时元数据合并成 catalog 运行时条目，并确认每个插件声明的运行时
 * 至少有一个满足 range 的版本可下载；否则该插件远程不可装，发布前就失败。
 */
export function collectCatalogRuntimes(input: {
  readonly metadata: readonly RuntimeComponentMetadata[];
  readonly downloadRootUrl: string;
  readonly plugins: readonly Pick<SignedPluginCatalogEntry, 'id' | 'version' | 'requiresRuntimes'>[];
}): PluginRuntimeEntry[] {
  const root = input.downloadRootUrl.replace(/\/+$/u, '');
  const grouped = new Map<string, PluginRuntimeEntry>();
  for (const item of input.metadata) {
    const key = `${item.id}@${item.version}`;
    const entry = grouped.get(key) ?? { id: item.id, version: item.version, targets: [] };
    if (entry.targets.some(target => target.platform === item.platform && target.architecture === item.architecture)) {
      throw new Error(`运行时 ${key} 的 ${item.platform}/${item.architecture} 重复`);
    }
    grouped.set(key, {
      ...entry,
      targets: [...entry.targets, {
        platform: item.platform,
        architecture: item.architecture,
        artifactUrl: `${root}/runtimes/${item.id}/${item.version}/${item.platform}-${item.architecture}/${item.artifactFile}`,
        sha512: item.sha512,
        size: item.size,
        unpackedSize: item.unpackedSize,
        executable: item.executable,
        executableSha256: item.executableSha256,
      }],
    });
  }
  const runtimes = [...grouped.values()];
  for (const plugin of input.plugins) {
    for (const requirement of plugin.requiresRuntimes) {
      const satisfied = runtimes.some(runtime => runtime.id === requirement.id && satisfiesSemverRange(runtime.version, requirement.range));
      if (!satisfied) {
        throw new Error(`${plugin.id}@${plugin.version} 需要运行时 ${requirement.id} ${requirement.range}，但没有可发布的组件`);
      }
    }
  }
  return runtimes;
}
