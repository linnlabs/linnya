import type { PluginId } from '@app/schemas';
import { backendPluginRegistry } from './registry';
import { getRuntimeEnabledPluginIds } from './pluginRuntimeState';

/** App 完成注册后使用的运行查询。这里只读贡献，不加载磁盘插件或执行启动装配。 */
export function resolveEnabledIds(enabledIds?: ReadonlySet<PluginId> | null): ReadonlySet<PluginId> | null {
  return enabledIds === undefined ? getRuntimeEnabledPluginIds() : enabledIds;
}

export function getRegisteredToolContextBindingMigrators(
  enabledIds?: ReadonlySet<PluginId> | null
) {
  return backendPluginRegistry.getToolContextBindingMigrators(resolveEnabledIds(enabledIds));
}

export function getRegisteredAgentFenceDescriptors(enabledIds?: ReadonlySet<PluginId> | null) {
  return backendPluginRegistry
    .getAgentFenceRegistrations(resolveEnabledIds(enabledIds))
    .map(registration => registration.descriptor);
}

export function getBackendPluginRegistryRevision(): number {
  return backendPluginRegistry.getRevision();
}

export function getRegisteredSubagentTypes(enabledIds?: ReadonlySet<PluginId> | null) {
  return backendPluginRegistry.getSubagentTypes(resolveEnabledIds(enabledIds));
}

export function getRegisteredBackendPluginRendererPushChannels(
  pluginId: PluginId,
  enabledIds?: ReadonlySet<PluginId> | null
) {
  return backendPluginRegistry.getRendererPushChannelsForPlugin(
    pluginId,
    resolveEnabledIds(enabledIds)
  );
}
