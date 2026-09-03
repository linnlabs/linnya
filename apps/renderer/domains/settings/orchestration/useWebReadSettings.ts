import { computed, ref } from 'vue';
import type {
  WebReadConfig,
  WebReadConfigView,
  WebReadCredentialReaderId,
  WebReadManagedReaderId,
} from '../../../../../src/tools/web/webread/definitions/webReadConfig';
import {
  webReadConfigGateway,
  type WebReadConfigGatewayResult,
  type WebReadConnectionTestResult,
} from '../../../shared/ipc/webReadConfigGateway';

export type WebReadSettingsFeedback =
  | { readonly kind: 'success'; readonly code: 'saved' }
  | { readonly kind: 'success'; readonly code: 'connection_ok'; readonly tookMs: number }
  | { readonly kind: 'error'; readonly message: string };

export type WebReadSettingsValidationError = 'missing_byok_key';

export interface WebReadSettingsGateway {
  get(): Promise<WebReadConfigGatewayResult<WebReadConfigView>>;
  set(config: WebReadConfig): Promise<WebReadConfigGatewayResult<WebReadConfigView>>;
  testConnection(
    config: WebReadConfig,
  ): Promise<WebReadConfigGatewayResult<WebReadConnectionTestResult>>;
}

export function useWebReadSettings(
  gateway: WebReadSettingsGateway = webReadConfigGateway,
) {
  const renderEnabled = ref(true);
  const managedReader = ref<WebReadManagedReaderId>('none');
  const preferredManagedReader = ref<WebReadCredentialReaderId>('metaso_reader');
  const byokKey = ref('');
  const persisted = ref<WebReadConfigView>();
  const loading = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const feedback = ref<WebReadSettingsFeedback>();
  const validationError = ref<WebReadSettingsValidationError>();

  const managedEnabled = computed(() => managedReader.value !== 'none');
  const activeCredentialState = computed(() => managedReader.value === 'none'
    ? undefined
    : persisted.value?.readers[managedReader.value]);
  const hasStoredKeyForCurrentReader = computed(() =>
    activeCredentialState.value?.hasStoredByokKey === true);
  const credentialAvailableForCurrentReader = computed(() =>
    activeCredentialState.value?.credentialAvailable === true);

  function applyView(view: WebReadConfigView): void {
    persisted.value = view;
    renderEnabled.value = view.renderEnabled;
    managedReader.value = view.managedReader;
    if (view.managedReader !== 'none') preferredManagedReader.value = view.managedReader;
    byokKey.value = '';
  }

  async function load(): Promise<void> {
    loading.value = true;
    feedback.value = undefined;
    try {
      const result = await gateway.get();
      if (result.success) applyView(result.data);
      else feedback.value = { kind: 'error', message: result.error };
    } catch (error: unknown) {
      feedback.value = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      loading.value = false;
    }
  }

  function resetManagedReaderFeedback(): void {
    byokKey.value = '';
    feedback.value = undefined;
    validationError.value = undefined;
  }

  function selectManagedReader(reader: WebReadCredentialReaderId): void {
    preferredManagedReader.value = reader;
    managedReader.value = reader;
    resetManagedReaderFeedback();
  }

  async function setManagedEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      managedReader.value = preferredManagedReader.value;
      resetManagedReaderFeedback();
      return;
    }

    const previousReader = managedReader.value;
    if (previousReader !== 'none') preferredManagedReader.value = previousReader;
    managedReader.value = 'none';
    resetManagedReaderFeedback();
    if (!await save()) managedReader.value = previousReader;
  }

  async function setRenderEnabled(enabled: boolean): Promise<void> {
    const previousValue = renderEnabled.value;
    renderEnabled.value = enabled;
    feedback.value = undefined;
    validationError.value = undefined;
    if (!managedEnabled.value && !await save()) renderEnabled.value = previousValue;
  }

  function buildConfig(): WebReadConfig | undefined {
    validationError.value = undefined;
    if (managedReader.value === 'none') {
      return { renderEnabled: renderEnabled.value, managedReader: 'none' };
    }
    const key = byokKey.value.trim();
    if (!key && !credentialAvailableForCurrentReader.value) {
      validationError.value = 'missing_byok_key';
      return undefined;
    }
    return {
      renderEnabled: renderEnabled.value,
      managedReader: managedReader.value,
      ...(key ? { byokKey: key } : {}),
    };
  }

  async function save(): Promise<boolean> {
    const config = buildConfig();
    if (!config) return false;
    saving.value = true;
    feedback.value = undefined;
    try {
      const result = await gateway.set(config);
      if (result.success) {
        applyView(result.data);
        feedback.value = { kind: 'success', code: 'saved' };
        return true;
      } else {
        feedback.value = { kind: 'error', message: result.error };
        return false;
      }
    } catch (error: unknown) {
      feedback.value = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function testConnection(): Promise<void> {
    const config = buildConfig();
    if (!config || config.managedReader === 'none') return;
    testing.value = true;
    feedback.value = undefined;
    try {
      const result = await gateway.testConnection(config);
      feedback.value = result.success
        ? { kind: 'success', code: 'connection_ok', tookMs: result.data.tookMs }
        : { kind: 'error', message: result.error };
    } catch (error: unknown) {
      feedback.value = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      testing.value = false;
    }
  }

  return {
    renderEnabled,
    managedReader,
    byokKey,
    loading,
    saving,
    testing,
    feedback,
    validationError,
    managedEnabled,
    hasStoredKeyForCurrentReader,
    credentialAvailableForCurrentReader,
    load,
    setRenderEnabled,
    setManagedEnabled,
    selectManagedReader,
    save,
    testConnection,
  };
}
