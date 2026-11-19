import type { PluginStoreListItem, PluginStateView } from '@app/schemas';

export function isPluginVisibleInStore(state: PluginStateView): boolean {
  return state.meta.required !== true;
}

export function buildPluginStoreList(
  states: readonly PluginStateView[],
  options: { readonly bundledPluginIds?: ReadonlySet<string> } = {},
): PluginStoreListItem[] {
  return states
    .filter(isPluginVisibleInStore)
    .map(state => ({
      ...state,
      ...(options.bundledPluginIds
        ? { bundledSourceAvailable: options.bundledPluginIds.has(state.meta.id) }
        : {}),
    }));
}
