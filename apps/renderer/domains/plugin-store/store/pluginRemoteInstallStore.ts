import type {
  PluginId,
  PluginInstallProgressEvent,
  PluginRemoteCatalogItem,
  PluginRemoteCatalogResult,
} from '@app/schemas';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { PluginRuntimeUserError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import {
  applyRemoteInstallProgress,
  createRemoteInstallProgress,
  type RemoteInstallProgressState,
} from '../functions/pluginRemoteInstallProgress';

/** 安装结束后的结果提示：取消与失败分开，便于详情页给出不同说明；下一次安装开始时清除。 */
export type RemoteInstallOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: PluginRuntimeUserError };

/**
 * 远程插件的商店状态：已验签 catalog 的条目、正在进行的安装进度与最近一次结果。
 * 只持有状态与同步 action；拉取、安装、取消与进度订阅在 orchestration/pluginRemoteInstall。
 */
export const usePluginRemoteInstallStore = defineStore('pluginRemoteInstall', () => {
  const catalog = ref<PluginRemoteCatalogResult | null>(null);
  const isCatalogLoading = ref(false);
  const progressByPluginId = ref<Readonly<Record<PluginId, RemoteInstallProgressState>>>({});
  const outcomeByPluginId = ref<Readonly<Record<PluginId, RemoteInstallOutcome>>>({});

  const catalogItemsById = computed<ReadonlyMap<PluginId, PluginRemoteCatalogItem>>(() => (
    catalog.value?.status === 'available'
      ? new Map(catalog.value.items.map(item => [item.id, item]))
      : new Map()
  ));
  /** 来源已开放但拉取或验签失败：只禁用安装与更新，已安装插件照常使用。 */
  const isCatalogUnavailable = computed(() => catalog.value?.status === 'unavailable');

  function beginCatalogLoad(): void {
    isCatalogLoading.value = true;
  }

  function catalogLoaded(result: PluginRemoteCatalogResult): void {
    catalog.value = result;
    isCatalogLoading.value = false;
  }

  function isInstalling(pluginId: PluginId): boolean {
    return Object.prototype.hasOwnProperty.call(progressByPluginId.value, pluginId);
  }

  function applyProgress(event: PluginInstallProgressEvent): void {
    const current = progressByPluginId.value[event.pluginId] ?? createRemoteInstallProgress();
    progressByPluginId.value = {
      ...progressByPluginId.value,
      [event.pluginId]: applyRemoteInstallProgress(current, event.progress),
    };
  }

  function beginInstall(pluginId: PluginId): void {
    dismissOutcome(pluginId);
    progressByPluginId.value = { ...progressByPluginId.value, [pluginId]: createRemoteInstallProgress() };
  }

  function finishInstall(pluginId: PluginId, outcome: RemoteInstallOutcome | null): void {
    const progress = { ...progressByPluginId.value };
    delete progress[pluginId];
    progressByPluginId.value = progress;
    if (outcome) outcomeByPluginId.value = { ...outcomeByPluginId.value, [pluginId]: outcome };
  }

  function dismissOutcome(pluginId: PluginId): void {
    const next = { ...outcomeByPluginId.value };
    delete next[pluginId];
    outcomeByPluginId.value = next;
  }

  return {
    catalog,
    isCatalogLoading,
    catalogItemsById,
    isCatalogUnavailable,
    progressByPluginId,
    outcomeByPluginId,
    beginCatalogLoad,
    catalogLoaded,
    isInstalling,
    applyProgress,
    beginInstall,
    finishInstall,
    dismissOutcome,
  };
});
