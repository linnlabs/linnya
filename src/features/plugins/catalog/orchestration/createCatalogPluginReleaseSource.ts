import {
  PLUGIN_RUNTIME_ARCHITECTURES,
  PLUGIN_RUNTIME_PLATFORMS,
  type PluginCatalogChannel,
  type PluginRuntimeArchitecture,
  type PluginRuntimePlatform,
} from '@app/schemas';

import type { RemotePluginRelease, RemotePluginReleaseSource } from '../../install/definitions/pluginInstall';
import { PluginOperationError } from '../../install/definitions/pluginOperationError';
import type { TrustedPluginCatalogKeys } from '../definitions/pluginCatalog';
import { selectCatalogPluginRelease } from '../functions/selectCatalogPluginRelease';
import type { PluginCatalogStateStore } from '../infrastructure/pluginCatalogStateStore';
import { fetchVerifiedPluginCatalog } from './fetchVerifiedPluginCatalog';

function isPlatform(value: string): value is PluginRuntimePlatform {
  return (PLUGIN_RUNTIME_PLATFORMS as readonly string[]).includes(value);
}

function isArchitecture(value: string): value is PluginRuntimeArchitecture {
  return (PLUGIN_RUNTIME_ARCHITECTURES as readonly string[]).includes(value);
}

/**
 * official 组合的远程版本来源：每次解析都重新拉取并验签 catalog，选出本 Host 可安装的最高版本，
 * 并把签名信封作为来源证明交给安装流程写入回执。
 */
export function createCatalogPluginReleaseSource(input: {
  readonly catalogUrl: string;
  readonly channel: PluginCatalogChannel;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly stateStore: PluginCatalogStateStore;
  readonly platform: string;
  readonly architecture: string;
  readonly now?: () => Date;
  readonly allowLoopbackHttp?: boolean;
}): RemotePluginReleaseSource {
  return {
    async resolve({ pluginId, appVersion, rendererUiVersion, fetch }): Promise<RemotePluginRelease> {
      const { platform, architecture } = input;
      if (!isPlatform(platform) || !isArchitecture(architecture)) {
        throw new PluginOperationError('incompatible', `当前平台不提供远程插件: ${platform}/${architecture}`, { pluginId });
      }
      const catalog = await fetchVerifiedPluginCatalog({
        catalogUrl: input.catalogUrl,
        channel: input.channel,
        trustedKeys: input.trustedKeys,
        stateStore: input.stateStore,
        fetch,
        now: input.now,
        allowLoopbackHttp: input.allowLoopbackHttp,
      });
      const selection = selectCatalogPluginRelease({ catalog, pluginId, appVersion, rendererUiVersion, platform, architecture });
      if (selection.status === 'not-listed') {
        throw new PluginOperationError('source-unavailable', `插件 catalog 未列出 ${pluginId}`, { pluginId });
      }
      if (selection.status === 'runtime-unavailable') {
        throw new PluginOperationError('incompatible', `当前平台没有 ${pluginId}@${selection.latestVersion} 所需的运行时 ${selection.runtimeId}`, { pluginId });
      }
      if (selection.status === 'incompatible') {
        // 返回最高版本条目但不附来源证明；安装流程按兼容性给出跳过原因，不会下载。
        const latest = catalog.plugins.find(entry => entry.id === pluginId && entry.version === selection.latestVersion);
        if (!latest) throw new PluginOperationError('source-unavailable', `插件 catalog 未列出 ${pluginId}`, { pluginId });
        return {
          version: latest.version,
          url: latest.artifactUrl,
          sha512: latest.sha512,
          ...(latest.minApp ? { minApp: latest.minApp } : {}),
          ...(latest.rendererUi ? { rendererUi: latest.rendererUi } : {}),
        };
      }
      const { entry } = selection;
      return {
        version: entry.version,
        url: entry.artifactUrl,
        sha512: entry.sha512,
        ...(entry.minApp ? { minApp: entry.minApp } : {}),
        ...(entry.rendererUi ? { rendererUi: entry.rendererUi } : {}),
        provenance: { keyId: catalog.keyId, digest: catalog.digest, sequence: catalog.sequence, envelope: catalog.envelope },
        ...(selection.runtimes.length > 0 ? { runtimes: selection.runtimes } : {}),
      };
    },
  };
}
