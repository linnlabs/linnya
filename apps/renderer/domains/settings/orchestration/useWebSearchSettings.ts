import { computed, ref } from 'vue';
import type {
  WebSearchConfig,
  WebSearchConfigView,
  WebSearchEngineId,
  WebSearchKeySource,
} from '../../../../../src/tools/web/websearch/definitions/webSearchConfig';
import {
  webSearchConfigGateway,
  type WebSearchConfigGatewayResult,
  type WebSearchConnectionTestResult,
} from '../../../shared/ipc/webSearchConfigGateway';
import {
  requiresWebSearchApiKey,
} from '../definitions/webSearchSettings';

export type WebSearchSettingsFeedback =
  | { readonly kind: 'success'; readonly code: 'saved' }
  | { readonly kind: 'success'; readonly code: 'connection_ok'; readonly tookMs: number }
  | { readonly kind: 'error'; readonly message: string };

export type WebSearchSettingsValidationError = 'missing_byok_key' | 'missing_searxng_url';

export interface WebSearchSettingsGateway {
  get(): Promise<WebSearchConfigGatewayResult<WebSearchConfigView>>;
  set(config: WebSearchConfig): Promise<WebSearchConfigGatewayResult<WebSearchConfigView>>;
  testConnection(
    config: WebSearchConfig,
  ): Promise<WebSearchConfigGatewayResult<WebSearchConnectionTestResult>>;
}

export function useWebSearchSettings(
  gateway: WebSearchSettingsGateway = webSearchConfigGateway,
) {
  const engine = ref<WebSearchEngineId>('parallel_free');
  const keySource = ref<WebSearchKeySource>('none');
  const byokKey = ref('');
  const searxngBaseUrl = ref('');
  const persisted = ref<WebSearchConfigView>();
  const loading = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const feedback = ref<WebSearchSettingsFeedback>();
  const validationError = ref<WebSearchSettingsValidationError>();

  const requiresApiKey = computed(() => requiresWebSearchApiKey(engine.value));
  const hasStoredKeyForCurrentEngine = computed(() =>
    keySource.value === 'byok'
    && persisted.value?.engines[engine.value]?.hasByokKey === true);

  function applyView(view: WebSearchConfigView): void {
    const active = view.engines[view.engine];
    if (!active) throw new Error('网络搜索配置缺少当前引擎状态。');
    persisted.value = view;
    engine.value = view.engine;
    keySource.value = active.keySource;
    searxngBaseUrl.value = active.searxngBaseUrl ?? '';
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

  function selectEngine(nextEngine: WebSearchEngineId): void {
    engine.value = nextEngine;
    const saved = persisted.value?.engines[nextEngine];
    keySource.value = saved?.keySource
      ?? (requiresWebSearchApiKey(nextEngine) ? 'byok' : 'none');
    searxngBaseUrl.value = saved?.searxngBaseUrl ?? '';
    byokKey.value = '';
    feedback.value = undefined;
    validationError.value = undefined;
  }

  function buildConfig(): WebSearchConfig | undefined {
    validationError.value = undefined;
    if (engine.value === 'searxng') {
      const baseUrl = searxngBaseUrl.value.trim();
      if (!baseUrl) {
        validationError.value = 'missing_searxng_url';
        return undefined;
      }
      return { engine: engine.value, keySource: 'none', searxngBaseUrl: baseUrl };
    }
    if (requiresWebSearchApiKey(engine.value)) {
      const key = byokKey.value.trim();
      if (!key && !hasStoredKeyForCurrentEngine.value) {
        validationError.value = 'missing_byok_key';
        return undefined;
      }
      return {
        engine: engine.value,
        keySource: 'byok',
        ...(key ? { byokKey: key } : {}),
      };
    }
    return { engine: engine.value, keySource: 'none' };
  }

  async function save(): Promise<void> {
    const config = buildConfig();
    if (!config) return;
    saving.value = true;
    feedback.value = undefined;
    try {
      const result = await gateway.set(config);
      if (result.success) {
        applyView(result.data);
        feedback.value = { kind: 'success', code: 'saved' };
      } else {
        feedback.value = { kind: 'error', message: result.error };
      }
    } catch (error: unknown) {
      feedback.value = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      saving.value = false;
    }
  }

  async function testConnection(): Promise<void> {
    const config = buildConfig();
    if (!config) return;
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
    engine,
    keySource,
    byokKey,
    searxngBaseUrl,
    loading,
    saving,
    testing,
    feedback,
    validationError,
    requiresApiKey,
    hasStoredKeyForCurrentEngine,
    load,
    selectEngine,
    save,
    testConnection,
  };
}
