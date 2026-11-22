import {
  PluginRemoteCatalogResultSchema,
  type PluginId,
  type PluginRemoteCatalogItem,
  type PluginRemoteCatalogResult,
  type PluginRemoteInstallResult,
} from '@app/schemas';
import { isObjectLike } from '@linnya/foundation';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import {
  normalizePluginRuntimeUserError,
  type PluginRuntimeUserError,
} from '@/app/plugins/definitions/pluginRuntimeErrors';
import {
  applyRemoteInstallProgress,
  createRemoteInstallProgress,
  type RemoteInstallProgressState,
} from '../functions/pluginRemoteInstallProgress';

/** 安装结束后的结果提示：取消与失败分开，便于详情页给出不同说明；下一次安装开始时清除。 */
export type RemoteInstallOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: PluginRuntimeUserError };

const UNAVAILABLE_CATALOG: PluginRemoteCatalogResult = { status: 'unavailable', code: 'unknown' };

function parseRemoteCatalogResponse(response: unknown): PluginRemoteCatalogResult {
  if (!isObjectLike(response) || response.success !== true) return UNAVAILABLE_CATALOG;
  const parsed = PluginRemoteCatalogResultSchema.safeParse(response.data);
  return parsed.success ? parsed.data : UNAVAILABLE_CATALOG;
}

/**
 * 远程插件的商店状态：已验签 catalog 的条目、正在进行的安装进度与最近一次结果。
 * 进度订阅在第一次使用时建立并常驻，离开商店页面后安装继续，回来仍能接上进度。
 */
export const usePluginRemoteInstallStore = defineStore('pluginRemoteInstall', () => {
  const pluginsStore = useEnabledPluginsStore();
  const catalog = ref<PluginRemoteCatalogResult | null>(null);
  const isCatalogLoading = ref(false);
  const progressByPluginId = ref<Readonly<Record<PluginId, RemoteInstallProgressState>>>({});
  const outcomeByPluginId = ref<Readonly<Record<PluginId, RemoteInstallOutcome>>>({});
  let unsubscribeProgress: (() => void) | null = null;

  const catalogItemsById = computed<ReadonlyMap<PluginId, PluginRemoteCatalogItem>>(() => (
    catalog.value?.status === 'available'
      ? new Map(catalog.value.items.map(item => [item.id, item]))
      : new Map()
  ));
  /** 来源已开放但拉取或验签失败：只禁用安装与更新，已安装插件照常使用。 */
  const isCatalogUnavailable = computed(() => catalog.value?.status === 'unavailable');

  function ensureProgressSubscription(): void {
    if (unsubscribeProgress) return;
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.onInstallProgress) return;
    unsubscribeProgress = pluginsApi.onInstallProgress(event => {
      const current = progressByPluginId.value[event.pluginId] ?? createRemoteInstallProgress();
      progressByPluginId.value = {
        ...progressByPluginId.value,
        [event.pluginId]: applyRemoteInstallProgress(current, event.progress),
      };
    });
  }

  async function refreshCatalog(): Promise<void> {
    ensureProgressSubscription();
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.remoteCatalog) {
      catalog.value = { status: 'disabled' };
      return;
    }
    isCatalogLoading.value = true;
    try {
      catalog.value = parseRemoteCatalogResponse(await pluginsApi.remoteCatalog());
    } catch {
      catalog.value = UNAVAILABLE_CATALOG;
    } finally {
      isCatalogLoading.value = false;
    }
  }

  function isInstalling(pluginId: PluginId): boolean {
    return Object.prototype.hasOwnProperty.call(progressByPluginId.value, pluginId);
  }

  function setOutcome(pluginId: PluginId, outcome: RemoteInstallOutcome | null): void {
    const next = { ...outcomeByPluginId.value };
    if (outcome) next[pluginId] = outcome;
    else delete next[pluginId];
    outcomeByPluginId.value = next;
  }

  function clearProgress(pluginId: PluginId): void {
    const next = { ...progressByPluginId.value };
    delete next[pluginId];
    progressByPluginId.value = next;
  }

  /**
   * 发起远程安装并等待 Host 返回结果；失败与取消记为结果并继续抛出，由页面决定提示方式。
   * 结束后刷新 catalog，使下载大小反映刚装好的运行时。
   */
  async function install(pluginId: PluginId): Promise<PluginRemoteInstallResult> {
    ensureProgressSubscription();
    setOutcome(pluginId, null);
    progressByPluginId.value = { ...progressByPluginId.value, [pluginId]: createRemoteInstallProgress() };
    try {
      const result = await pluginsStore.installPluginFromRemote(pluginId);
      if (result.status === 'failed') {
        setOutcome(pluginId, {
          kind: 'failed',
          error: normalizePluginRuntimeUserError({ code: result.errorCode ?? 'unknown', pluginId, ...(result.diskSpace ? { diskSpace: result.diskSpace } : {}) }),
        });
      }
      return result;
    } catch (caught) {
      const error = normalizePluginRuntimeUserError(caught);
      setOutcome(pluginId, error.code === 'pluginOperationCancelled' ? { kind: 'cancelled' } : { kind: 'failed', error });
      throw caught;
    } finally {
      clearProgress(pluginId);
      void refreshCatalog();
    }
  }

  async function cancel(pluginId: PluginId): Promise<void> {
    await window.electronAPI?.plugins?.cancelRemoteInstall?.(pluginId);
  }

  function dismissOutcome(pluginId: PluginId): void {
    setOutcome(pluginId, null);
  }

  return {
    catalog,
    isCatalogLoading,
    catalogItemsById,
    isCatalogUnavailable,
    progressByPluginId,
    outcomeByPluginId,
    refreshCatalog,
    isInstalling,
    install,
    cancel,
    dismissOutcome,
  };
});
