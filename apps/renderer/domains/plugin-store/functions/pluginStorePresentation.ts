import type { PluginInstallState, PluginStoreListItem } from '@app/schemas';
import type { PluginStoreMessageResolver } from '../definitions/pluginStoreMessages';

export type PluginStoreStateTone = 'success' | 'neutral' | 'warning';

export function getPluginStateLabel(
  state: PluginInstallState,
  resolveMessage: PluginStoreMessageResolver,
): string {
  if (state === 'enabled') return resolveMessage('pluginStore.state.enabled');
  if (state === 'disabled') return resolveMessage('pluginStore.state.disabled');
  return resolveMessage('pluginStore.state.missing');
}

export function getPluginStateTone(state: PluginInstallState): PluginStoreStateTone {
  if (state === 'enabled') return 'success';
  if (state === 'disabled') return 'neutral';
  return 'warning';
}

export function isRequiredPlugin(item: PluginStoreListItem): boolean {
  return item.meta.required === true;
}

export function canTogglePlugin(item: PluginStoreListItem): boolean {
  return !item.runtimeUnavailable && !isRequiredPlugin(item) && item.state !== 'missing';
}

export function hasBundledPluginSource(item: PluginStoreListItem): boolean {
  return item.bundledSourceAvailable === true;
}

export function canUninstallPlugin(
  item: PluginStoreListItem,
  remoteServiceEnabled = false,
): boolean {
  return (hasBundledPluginSource(item) || remoteServiceEnabled)
    && !isRequiredPlugin(item)
    && item.state !== 'missing';
}

export function canInstallPluginFromBundled(item: PluginStoreListItem): boolean {
  return hasBundledPluginSource(item) && !isRequiredPlugin(item) && item.state === 'missing';
}

export function canInstallPluginFromRemote(item: PluginStoreListItem, remoteServiceEnabled: boolean): boolean {
  return remoteServiceEnabled && !isRequiredPlugin(item) && item.state === 'missing';
}

export function canCheckPluginUpdateFromRemote(item: PluginStoreListItem, remoteServiceEnabled: boolean): boolean {
  return remoteServiceEnabled && !isRequiredPlugin(item) && item.state !== 'missing';
}

export function getPluginToggleDisabledReason(
  item: PluginStoreListItem,
  resolveMessage: PluginStoreMessageResolver,
): string | null {
  if (isRequiredPlugin(item)) {
    return resolveMessage('pluginStore.reason.required');
  }
  if (item.state === 'missing') {
    return item.reason ?? resolveMessage('pluginStore.reason.notInstalled');
  }
  return null;
}
