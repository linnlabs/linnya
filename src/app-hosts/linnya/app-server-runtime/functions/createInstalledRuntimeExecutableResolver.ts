import { PLUGIN_RUNTIME_ARCHITECTURES, PLUGIN_RUNTIME_PLATFORMS, type PluginRuntimeArchitecture, type PluginRuntimePlatform } from '@app/schemas';

import { createPluginCatalogStateStore } from 'src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import { trustedPluginCatalogKeys } from 'src/features/plugins/catalog/registry/trustedPluginCatalogKeys';
import { resolveInstalledRuntimeExecutable } from 'src/features/runtimes/functions/resolveInstalledRuntimeExecutable';
import { getLogger } from 'src/shared/logger';

const logger = getLogger('InstalledRuntimeResolver');

/**
 * 为原生运行时（如 Qdrant）构造启动期解析函数：只返回已安装且复核通过的组件；
 * 未安装或复核失败返回 null，由调用方回退到安装包内的副本。复核失败只记诊断，不执行该文件。
 */
export function createInstalledRuntimeExecutableResolver(input: {
  readonly runtimeId: string;
  readonly runtimeRoot: string | undefined;
  readonly userPluginRoot: string | undefined;
  readonly platform: string;
  readonly architecture: string;
}): () => Promise<string | null> {
  return async () => {
    const { runtimeRoot } = input;
    const platform = input.platform as PluginRuntimePlatform;
    const architecture = input.architecture as PluginRuntimeArchitecture;
    if (!runtimeRoot || !PLUGIN_RUNTIME_PLATFORMS.includes(platform) || !PLUGIN_RUNTIME_ARCHITECTURES.includes(architecture)) return null;
    const resolution = await resolveInstalledRuntimeExecutable({
      runtimeRoot,
      runtimeId: input.runtimeId,
      platform,
      architecture,
      trustedKeys: trustedPluginCatalogKeys,
      laterRevocations: input.userPluginRoot ? createPluginCatalogStateStore({ userPluginRoot: input.userPluginRoot }).readRevocations() : [],
    });
    if (resolution.status === 'resolved') return resolution.executable;
    if (resolution.status === 'rejected') {
      logger.warn('runtime_component.rejected', { runtimeId: input.runtimeId, reason: resolution.reason });
    }
    return null;
  };
}
