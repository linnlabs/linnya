import type { PluginId } from '@app/schemas';

/** 磁盘加载器维护唯一目录事实；查询它不会反向触发插件加载。目录归属不授予额外信任。 */
export const registeredBackendPluginDirectories = new Map<PluginId, string>();

export function getRegisteredBackendPluginDirectory(pluginId: PluginId): string | undefined {
  return registeredBackendPluginDirectories.get(pluginId);
}
