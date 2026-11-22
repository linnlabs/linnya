import {
  PLUGIN_RUNTIME_ARCHITECTURES,
  PLUGIN_RUNTIME_PLATFORMS,
  type PluginRuntimeArchitecture,
  type PluginRuntimePlatform,
} from '@app/schemas';

/** 把 Node 的 process.platform/arch 收窄为 catalog 支持的平台；不支持时返回 null。 */
export function resolveCatalogPlatform(
  platform: string,
  architecture: string,
): { readonly platform: PluginRuntimePlatform; readonly architecture: PluginRuntimeArchitecture } | null {
  if (!(PLUGIN_RUNTIME_PLATFORMS as readonly string[]).includes(platform)) return null;
  if (!(PLUGIN_RUNTIME_ARCHITECTURES as readonly string[]).includes(architecture)) return null;
  return { platform: platform as PluginRuntimePlatform, architecture: architecture as PluginRuntimeArchitecture };
}
