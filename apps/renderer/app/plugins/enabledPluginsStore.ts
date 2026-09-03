import type {
  PluginDiagnosticView,
  PluginId,
  PluginMeta,
  PluginRemoteInstallResult,
  PluginRemoteUpdateCheckResult,
  PluginStoreDetail,
  PluginStateView,
  PluginStoreListItem,
} from '@app/schemas';
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { listRendererPluginMetas } from './registry';
import {
  createPluginRuntimeError,
  normalizePluginRuntimeUserError,
  type PluginRuntimeUserError,
} from './definitions/pluginRuntimeErrors';

interface PluginIpcSuccess {
  success: true;
  data: PluginStateView[];
}

interface PluginDiagnosticsIpcSuccess {
  success: true;
  data: readonly PluginDiagnosticView[];
}

interface PluginStoreListIpcSuccess {
  success: true;
  data: PluginStoreListItem[];
}

interface PluginStoreDetailIpcSuccess {
  success: true;
  data: PluginStoreDetail;
}

interface PluginRemoteInstallIpcSuccess {
  success: true;
  data: PluginRemoteInstallResult;
}

interface PluginRemoteUpdateCheckIpcSuccess {
  success: true;
  data: PluginRemoteUpdateCheckResult;
}

interface PluginIpcFailure {
  success: false;
  error: PluginRuntimeUserError;
}

type PluginListIpcResult = PluginIpcSuccess | PluginIpcFailure;
type PluginDiagnosticsIpcResult = PluginDiagnosticsIpcSuccess | PluginIpcFailure;
type PluginStoreListIpcResult = PluginStoreListIpcSuccess | PluginIpcFailure;
type PluginStoreDetailIpcResult = PluginStoreDetailIpcSuccess | PluginIpcFailure;
type PluginRemoteInstallIpcResult = PluginRemoteInstallIpcSuccess | PluginIpcFailure;
type PluginRemoteUpdateCheckIpcResult = PluginRemoteUpdateCheckIpcSuccess | PluginIpcFailure;

interface PluginBackendChangeSubscriptionOptions {
  afterRefresh?: () => void | Promise<void>;
}

interface PluginMutationSuccess {
  success: true;
}

interface PluginMutationFailure {
  success: false;
  error: PluginRuntimeUserError;
}

type PluginMutationResult = PluginMutationSuccess | PluginMutationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isPluginStateView(value: unknown): value is PluginStateView {
  if (!isRecord(value)) return false;
  const record = value;
  const meta = record.meta;
  if (!isRecord(meta)) return false;
  const metaRecord = meta;
  return (
    typeof metaRecord.id === 'string' &&
    typeof metaRecord.name === 'string' &&
    typeof metaRecord.version === 'string' &&
    typeof metaRecord.description === 'string' &&
    typeof metaRecord.developer === 'string' &&
    typeof metaRecord.builtin === 'boolean' &&
    (record.state === 'enabled' || record.state === 'disabled' || record.state === 'missing')
  );
}

function isPluginDiagnosticView(value: unknown): value is PluginDiagnosticView {
  if (!isRecord(value)) return false;
  return (
    (value.level === 'error' || value.level === 'warn' || value.level === 'info') &&
    (typeof value.pluginId === 'string' || value.pluginId === null) &&
    (typeof value.capability === 'string' || value.capability === null) &&
    typeof value.message === 'string' &&
    typeof value.at === 'number'
  );
}

function isPluginStoreListItem(value: unknown): value is PluginStoreListItem {
  if (!isRecord(value)) return false;
  return isPluginStateView(value);
}

function isPluginStoreCapability(
  value: unknown
): value is NonNullable<PluginStoreDetail['skills']>[number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    (value.description === undefined || typeof value.description === 'string')
  );
}

function isPluginReleaseNote(
  value: unknown
): value is NonNullable<PluginStoreDetail['releaseNotes']>[number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === 'string' &&
    value.version.trim().length > 0 &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.description === undefined || typeof value.description === 'string')
  );
}

function isPluginStoreDetail(value: unknown): value is PluginStoreDetail {
  if (!isRecord(value)) return false;
  const detailRecord = value;
  if (!isPluginStateView(value)) return false;

  const homepage = detailRecord.homepage;
  const details = detailRecord.details;
  const releaseNotes = detailRecord.releaseNotes;
  const skills = detailRecord.skills;
  const agents = detailRecord.agents;
  const sizeBytes = detailRecord.sizeBytes;

  return (
    (sizeBytes === undefined ||
      (typeof sizeBytes === 'number' && Number.isInteger(sizeBytes) && sizeBytes >= 0)) &&
    (homepage === undefined || typeof homepage === 'string') &&
    (details === undefined ||
      (Array.isArray(details) &&
        details.every(item => typeof item === 'string' && item.trim().length > 0))) &&
    (releaseNotes === undefined ||
      (Array.isArray(releaseNotes) && releaseNotes.every(isPluginReleaseNote))) &&
    (skills === undefined || (Array.isArray(skills) && skills.every(isPluginStoreCapability))) &&
    (agents === undefined || (Array.isArray(agents) && agents.every(isPluginStoreCapability)))
  );
}

function isPluginRemoteInstallResult(value: unknown): value is PluginRemoteInstallResult {
  if (!isRecord(value)) return false;
  if (value.status === 'installed') {
    return (
      typeof value.pluginId === 'string' &&
      typeof value.version === 'string' &&
      (typeof value.previousVersion === 'string' || value.previousVersion === null) &&
      value.restartRequired === true
    );
  }
  if (value.status === 'skipped') {
    return (
      typeof value.pluginId === 'string' &&
      typeof value.version === 'string' &&
      (value.reason === 'current' || value.reason === 'incompatible') &&
      (value.detail === undefined || typeof value.detail === 'string')
    );
  }
  if (value.status === 'failed') {
    return (
      typeof value.pluginId === 'string' &&
      (typeof value.version === 'string' || value.version === null) &&
      typeof value.error === 'string'
    );
  }
  return false;
}

function isPluginRemoteUpdateCheckResult(value: unknown): value is PluginRemoteUpdateCheckResult {
  if (!isRecord(value)) return false;
  if (value.status === 'available') {
    return (
      typeof value.pluginId === 'string' &&
      (typeof value.currentVersion === 'string' || value.currentVersion === null) &&
      typeof value.latestVersion === 'string' &&
      (value.minApp === undefined || typeof value.minApp === 'string') &&
      (value.rendererUi === undefined || typeof value.rendererUi === 'string')
    );
  }
  if (value.status === 'current') {
    return (
      typeof value.pluginId === 'string' &&
      typeof value.currentVersion === 'string' &&
      typeof value.latestVersion === 'string'
    );
  }
  if (value.status === 'incompatible') {
    return (
      typeof value.pluginId === 'string' &&
      (typeof value.currentVersion === 'string' || value.currentVersion === null) &&
      typeof value.latestVersion === 'string' &&
      typeof value.detail === 'string'
    );
  }
  if (value.status === 'failed') {
    return (
      typeof value.pluginId === 'string' &&
      (typeof value.currentVersion === 'string' || value.currentVersion === null) &&
      (typeof value.latestVersion === 'string' || value.latestVersion === null) &&
      typeof value.error === 'string'
    );
  }
  return false;
}

function parsePluginListResult(result: unknown): PluginListIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginStateResponseInvalid') };
  }

  const record = result;
  if (record.success !== true) {
    return {
      success: false,
      error: typeof record.error === 'string'
        ? record.error
        : createPluginRuntimeError('pluginStateReadFailed'),
    };
  }

  if (!Array.isArray(record.data) || !record.data.every(isPluginStateView)) {
    return { success: false, error: createPluginRuntimeError('pluginStateSchemaInvalid') };
  }

  return { success: true, data: record.data };
}

function parsePluginStoreListResult(result: unknown): PluginStoreListIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginStoreListResponseInvalid') };
  }

  const record = result;
  if (record.success !== true) {
    return {
      success: false,
      error: typeof record.error === 'string'
        ? record.error
        : createPluginRuntimeError('pluginStoreListReadFailed'),
    };
  }

  if (!Array.isArray(record.data) || !record.data.every(isPluginStoreListItem)) {
    return { success: false, error: createPluginRuntimeError('pluginStoreListSchemaInvalid') };
  }

  return { success: true, data: record.data };
}

function parsePluginStoreDetailResult(result: unknown): PluginStoreDetailIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginStoreDetailResponseInvalid') };
  }

  const record = result;
  if (record.success !== true) {
    return {
      success: false,
      error: typeof record.error === 'string'
        ? record.error
        : createPluginRuntimeError('pluginStoreDetailReadFailed'),
    };
  }

  if (!isPluginStoreDetail(record.data)) {
    return { success: false, error: createPluginRuntimeError('pluginStoreDetailSchemaInvalid') };
  }

  return { success: true, data: record.data };
}

function parsePluginRemoteInstallResult(result: unknown): PluginRemoteInstallIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginRemoteInstallResponseInvalid') };
  }

  const record = result;
  if (record.success !== true) {
    return {
      success: false,
      error: typeof record.error === 'string'
        ? record.error
        : createPluginRuntimeError('pluginRemoteInstallFailed'),
    };
  }

  if (!isPluginRemoteInstallResult(record.data)) {
    return { success: false, error: createPluginRuntimeError('pluginRemoteInstallSchemaInvalid') };
  }

  return { success: true, data: record.data };
}

function parsePluginRemoteUpdateCheckResult(result: unknown): PluginRemoteUpdateCheckIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginRemoteUpdateCheckResponseInvalid') };
  }

  const record = result;
  if (record.success !== true) {
    return {
      success: false,
      error: typeof record.error === 'string'
        ? record.error
        : createPluginRuntimeError('pluginRemoteUpdateCheckFailed'),
    };
  }

  if (!isPluginRemoteUpdateCheckResult(record.data)) {
    return { success: false, error: createPluginRuntimeError('pluginRemoteUpdateCheckSchemaInvalid') };
  }

  return { success: true, data: record.data };
}

function parsePluginDiagnosticsResult(result: unknown): PluginDiagnosticsIpcResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginDiagnosticsResponseInvalid') };
  }

  if (result.success !== true) {
    return {
      success: false,
      error: typeof result.error === 'string'
        ? result.error
        : createPluginRuntimeError('pluginDiagnosticsReadFailed'),
    };
  }

  if (!Array.isArray(result.data) || !result.data.every(isPluginDiagnosticView)) {
    return { success: false, error: createPluginRuntimeError('pluginDiagnosticsSchemaInvalid') };
  }

  return { success: true, data: result.data };
}

function parsePluginMutationResult(result: unknown): PluginMutationResult {
  if (!isRecord(result)) {
    return { success: false, error: createPluginRuntimeError('pluginMutationResponseInvalid') };
  }
  if (result.success === true) {
    return { success: true };
  }
  return {
    success: false,
    error: typeof result.error === 'string'
      ? result.error
      : createPluginRuntimeError('pluginMutationFailed'),
  };
}

function throwPluginRuntimeError(error: PluginRuntimeUserError): never {
  if (typeof error === 'string') {
    throw new Error(error);
  }
  throw error;
}

function readPluginStoreError(caught: unknown): PluginRuntimeUserError {
  return normalizePluginRuntimeUserError(caught);
}

function stateViewsFromRegisteredMetas(metas: readonly PluginMeta[]): PluginStateView[] {
  return metas.map(meta => ({ meta, state: 'enabled' as const }));
}

export const useEnabledPluginsStore = defineStore('enabledPlugins', () => {
  const states = ref<PluginStateView[]>([]);
  const isLoading = ref(false);
  const hasLoaded = ref(false);
  const error = ref<PluginRuntimeUserError | null>(null);
  const isStoreItemsLoading = ref(false);
  const hasLoadedStoreItems = ref(false);
  const storeItemsError = ref<PluginRuntimeUserError | null>(null);
  const storeDetailsByPluginId = ref<Record<PluginId, PluginStoreDetail>>({});
  const storeDetailError = ref<PluginRuntimeUserError | null>(null);
  const diagnostics = ref<PluginDiagnosticView[]>([]);
  const diagnosticsError = ref<PluginRuntimeUserError | null>(null);

  const stateByPluginId = computed(
    () => new Map(states.value.map(state => [state.meta.id, state]))
  );
  const enabledPluginIds = computed<ReadonlySet<PluginId>>(
    () =>
      new Set(states.value.filter(state => state.state === 'enabled').map(state => state.meta.id))
  );
  const storeItems = computed<PluginStoreListItem[]>(() =>
    states.value.map(state => ({ ...state }))
  );

  function seedFromRegisteredRendererPlugins(): void {
    if (hasLoaded.value || states.value.length > 0) return;
    states.value = stateViewsFromRegisteredMetas(listRendererPluginMetas());
  }

  function isPluginEnabled(pluginId: PluginId): boolean {
    const state = stateByPluginId.value.get(pluginId);
    if (!state) return false;
    return state.state === 'enabled';
  }

  function getPluginState(pluginId: PluginId): PluginStateView | null {
    return stateByPluginId.value.get(pluginId) ?? null;
  }

  async function refresh(): Promise<void> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi) {
      states.value = stateViewsFromRegisteredMetas(listRendererPluginMetas());
      hasLoaded.value = true;
      error.value = null;
      return;
    }

    isLoading.value = true;
    try {
      const result = parsePluginListResult(await pluginsApi.list());
      if (!result.success) {
        throwPluginRuntimeError(result.error);
      }
      states.value = result.data;
      hasLoaded.value = true;
      error.value = null;
    } catch (caught) {
      error.value = readPluginStoreError(caught);
      throw caught;
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshDiagnostics(): Promise<void> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi) {
      diagnostics.value = [];
      diagnosticsError.value = null;
      return;
    }

    try {
      const result = parsePluginDiagnosticsResult(await pluginsApi.diagnostics());
      if (!result.success) {
        throwPluginRuntimeError(result.error);
      }
      diagnostics.value = [...result.data];
      diagnosticsError.value = null;
    } catch (caught) {
      diagnosticsError.value = readPluginStoreError(caught);
      throw caught;
    }
  }

  async function refreshStoreItems(): Promise<void> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.storeList) {
      if (!hasLoaded.value) {
        states.value = stateViewsFromRegisteredMetas(listRendererPluginMetas());
        hasLoaded.value = true;
        error.value = null;
      }
      hasLoadedStoreItems.value = true;
      storeItemsError.value = null;
      return;
    }

    isStoreItemsLoading.value = true;
    try {
      const result = parsePluginStoreListResult(await pluginsApi.storeList());
      if (!result.success) {
        throwPluginRuntimeError(result.error);
      }
      if (!hasLoaded.value) {
        states.value = result.data;
        hasLoaded.value = true;
        error.value = null;
      }
      hasLoadedStoreItems.value = true;
      storeItemsError.value = null;
    } catch (caught) {
      storeItemsError.value = readPluginStoreError(caught);
      throw caught;
    } finally {
      isStoreItemsLoading.value = false;
    }
  }

  async function loadStoreDetail(pluginId: PluginId): Promise<PluginStoreDetail> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.getDetail) {
      const fallback = storeItems.value.find(item => item.meta.id === pluginId);
      if (!fallback) {
        throw createPluginRuntimeError('pluginStoreDetailUnavailable', { pluginId });
      }
      const detail: PluginStoreDetail = { ...fallback };
      storeDetailsByPluginId.value = {
        ...storeDetailsByPluginId.value,
        [pluginId]: detail,
      };
      storeDetailError.value = null;
      return detail;
    }

    try {
      const result = parsePluginStoreDetailResult(await pluginsApi.getDetail(pluginId));
      if (!result.success) {
        throwPluginRuntimeError(result.error);
      }
      storeDetailsByPluginId.value = {
        ...storeDetailsByPluginId.value,
        [pluginId]: result.data,
      };
      storeDetailError.value = null;
      return result.data;
    } catch (caught) {
      storeDetailError.value = readPluginStoreError(caught);
      throw caught;
    }
  }

  async function runMutation(operation: () => Promise<unknown>): Promise<void> {
    const result = parsePluginMutationResult(await operation());
    if (!result.success) {
      throwPluginRuntimeError(result.error);
    }
    await refresh();
    if (hasLoadedStoreItems.value) {
      await refreshStoreItems();
    }
  }

  async function checkPluginRemoteUpdate(
    pluginId: PluginId
  ): Promise<PluginRemoteUpdateCheckResult> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.checkRemoteUpdate) {
      throw createPluginRuntimeError('pluginRemoteUpdateCheckUnsupported');
    }

    const result = parsePluginRemoteUpdateCheckResult(await pluginsApi.checkRemoteUpdate(pluginId));
    if (!result.success) {
      throwPluginRuntimeError(result.error);
    }
    return result.data;
  }

  async function installPluginFromRemote(pluginId: PluginId): Promise<PluginRemoteInstallResult> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi?.installFromRemote) {
      throw createPluginRuntimeError('pluginRemoteInstallUnsupported');
    }

    const result = parsePluginRemoteInstallResult(await pluginsApi.installFromRemote(pluginId));
    if (!result.success) {
      throwPluginRuntimeError(result.error);
    }
    await refresh();
    if (hasLoadedStoreItems.value) {
      await refreshStoreItems();
    }
    return result.data;
  }

  async function uninstallPlugin(pluginId: PluginId): Promise<void> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi) {
      throw createPluginRuntimeError('pluginUninstallUnsupported');
    }
    await runMutation(() => pluginsApi.uninstall(pluginId));
  }

  async function setPluginEnabled(pluginId: PluginId, enabled: boolean): Promise<void> {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi) {
      throw createPluginRuntimeError('pluginToggleUnsupported');
    }
    await runMutation(() => pluginsApi.setEnabled(pluginId, enabled));
  }

  async function initialize(): Promise<void> {
    seedFromRegisteredRendererPlugins();
    await refresh();
    await refreshDiagnostics();
  }

  function subscribeToBackendChanges(
    options: PluginBackendChangeSubscriptionOptions = {}
  ): () => void {
    const pluginsApi = window.electronAPI?.plugins;
    if (!pluginsApi) return () => {};

    return pluginsApi.onChanged(() => {
      void (async () => {
        try {
          await refresh();
          if (hasLoadedStoreItems.value) {
            await refreshStoreItems();
          }
          await refreshDiagnostics();
          await options.afterRefresh?.();
        } catch (caught) {
          console.warn('[enabledPluginsStore] 插件变更刷新失败:', caught);
        }
      })();
    });
  }

  return {
    states,
    isLoading,
    hasLoaded,
    error,
    storeItems,
    isStoreItemsLoading,
    hasLoadedStoreItems,
    storeItemsError,
    storeDetailsByPluginId,
    storeDetailError,
    diagnostics,
    diagnosticsError,
    enabledPluginIds,
    seedFromRegisteredRendererPlugins,
    isPluginEnabled,
    getPluginState,
    refresh,
    refreshStoreItems,
    loadStoreDetail,
    refreshDiagnostics,
    initialize,
    checkPluginRemoteUpdate,
    installPluginFromRemote,
    uninstallPlugin,
    setPluginEnabled,
    subscribeToBackendChanges,
    normalizeUserError: normalizePluginRuntimeUserError,
  };
});
