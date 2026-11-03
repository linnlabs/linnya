import { watch } from 'vue';
import type { RendererPluginAvailabilityChange, RendererPluginRuntimePort } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
import { useEnabledPluginsStore } from '../enabledPluginsStore';
import { getRendererPluginContribution, useRendererPluginRegistryRevision } from '../registry';

/** 只投影现有安装/启停真源；watch留在App组合层，不把Pinia或registry交给插件。 */
export function createRendererPluginRuntimePort(): RendererPluginRuntimePort {
  const store = useEnabledPluginsStore(), revision = useRendererPluginRegistryRevision();
  const snapshot = (): readonly RendererPluginAvailabilityChange[] => {
    void revision.value;
    return store.states.map(item => ({ pluginId: item.meta.id, state: item.state, documentNodeTypes: getRendererPluginContribution(item.meta.id)?.documentTypes?.map(type => type.nodeType) ?? [] }));
  };
  return { read: pluginId => store.getPluginState(pluginId)?.state ?? 'missing',
    subscribe(listener) {
      return watch(snapshot, (next, previous) => {
        const oldById = new Map(previous.map(item => [item.pluginId, item])), newById = new Map(next.map(item => [item.pluginId, item]));
        const changed: RendererPluginAvailabilityChange[] = [];
        for (const pluginId of new Set([...oldById.keys(), ...newById.keys()])) {
          const before = oldById.get(pluginId), after = newById.get(pluginId);
          if (before?.state === after?.state && JSON.stringify(before?.documentNodeTypes) === JSON.stringify(after?.documentNodeTypes)) continue;
          changed.push({ pluginId, state: after?.state ?? 'missing', documentNodeTypes: [...new Set([...(before?.documentNodeTypes ?? []), ...(after?.documentNodeTypes ?? [])])] });
        }
        if (changed.length) listener(changed);
      });
    },
  };
}
