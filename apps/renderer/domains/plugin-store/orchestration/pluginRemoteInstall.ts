import {
  PluginRemoteCatalogResultSchema,
  type PluginId,
  type PluginRemoteCatalogResult,
  type PluginRemoteInstallResult,
} from '@app/schemas';
import { isObjectLike } from '@linnya/foundation';

import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { normalizePluginRuntimeUserError } from '@/app/plugins/definitions/pluginRuntimeErrors';
import { usePluginRemoteInstallStore } from '../store/pluginRemoteInstallStore';

const UNAVAILABLE_CATALOG: PluginRemoteCatalogResult = { status: 'unavailable', code: 'unknown' };
/** 每个 store 实例（每个 Pinia）只建一个进度订阅；常驻，离开商店后安装继续，回来仍能接上进度。 */
const progressSubscriptions = new WeakMap<object, () => void>();

function parseRemoteCatalogResponse(response: unknown): PluginRemoteCatalogResult {
  if (!isObjectLike(response) || response.success !== true) return UNAVAILABLE_CATALOG;
  const parsed = PluginRemoteCatalogResultSchema.safeParse(response.data);
  return parsed.success ? parsed.data : UNAVAILABLE_CATALOG;
}

export function ensureRemoteInstallProgressSubscription(): void {
  const store = usePluginRemoteInstallStore();
  if (progressSubscriptions.has(store)) return;
  const pluginsApi = window.electronAPI?.plugins;
  if (!pluginsApi?.onInstallProgress) return;
  progressSubscriptions.set(store, pluginsApi.onInstallProgress(event => store.applyProgress(event)));
}

/** 读取已验签 catalog；来源未开放时为 disabled（Host 不发请求），失败或格式不符时为 unavailable。 */
export async function refreshRemoteCatalog(): Promise<void> {
  ensureRemoteInstallProgressSubscription();
  const store = usePluginRemoteInstallStore();
  const pluginsApi = window.electronAPI?.plugins;
  if (!pluginsApi?.remoteCatalog) {
    store.catalogLoaded({ status: 'disabled' });
    return;
  }
  store.beginCatalogLoad();
  try {
    store.catalogLoaded(parseRemoteCatalogResponse(await pluginsApi.remoteCatalog()));
  } catch {
    store.catalogLoaded(UNAVAILABLE_CATALOG);
  }
}

/**
 * 发起远程安装并等待 Host 返回结果；失败与取消记为结果并继续抛出，由页面决定提示方式。
 * 结束后刷新 catalog，使下载大小反映刚装好的运行时。
 */
export async function installRemotePlugin(pluginId: PluginId): Promise<PluginRemoteInstallResult> {
  ensureRemoteInstallProgressSubscription();
  const store = usePluginRemoteInstallStore();
  store.beginInstall(pluginId);
  let outcomeRecorded = false;
  try {
    const result = await useEnabledPluginsStore().installPluginFromRemote(pluginId);
    if (result.status === 'failed') {
      store.finishInstall(pluginId, {
        kind: 'failed',
        error: normalizePluginRuntimeUserError({
          code: result.errorCode ?? 'unknown',
          pluginId,
          ...(result.diskSpace ? { diskSpace: result.diskSpace } : {}),
        }),
      });
      outcomeRecorded = true;
    }
    return result;
  } catch (caught) {
    const error = normalizePluginRuntimeUserError(caught);
    store.finishInstall(pluginId, error.code === 'pluginOperationCancelled' ? { kind: 'cancelled' } : { kind: 'failed', error });
    outcomeRecorded = true;
    throw caught;
  } finally {
    if (!outcomeRecorded) store.finishInstall(pluginId, null);
    void refreshRemoteCatalog();
  }
}

export async function cancelRemoteInstall(pluginId: PluginId): Promise<void> {
  await window.electronAPI?.plugins?.cancelRemoteInstall?.(pluginId);
}
