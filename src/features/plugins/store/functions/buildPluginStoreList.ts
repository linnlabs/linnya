import type { PluginStoreListItem, PluginStateView } from '@app/schemas';

export function isPluginVisibleInStore(state: PluginStateView): boolean {
  return state.meta.required !== true;
}

export function buildPluginStoreList(states: readonly PluginStateView[]): PluginStoreListItem[] {
  return states.filter(isPluginVisibleInStore);
}
