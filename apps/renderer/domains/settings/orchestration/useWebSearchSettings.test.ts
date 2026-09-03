import { describe, expect, it, vi } from 'vitest';
import type {
  WebSearchConfig,
  WebSearchConfigView,
  WebSearchEngineConfigView,
  WebSearchEngineId,
} from '../../../../../src/tools/web/websearch/definitions/webSearchConfig';
import type { WebSearchSettingsGateway } from './useWebSearchSettings';
import { useWebSearchSettings } from './useWebSearchSettings';

function createGateway(initial: WebSearchConfigView) {
  let current = initial;
  const set = vi.fn(async (config: WebSearchConfig) => {
    const existing = current.engines[config.engine];
    current = {
      engine: config.engine,
      engines: {
        ...current.engines,
        [config.engine]: {
          keySource: config.keySource,
          hasByokKey: Boolean(config.byokKey) || existing?.hasByokKey === true,
          ...(config.searxngBaseUrl ? { searxngBaseUrl: config.searxngBaseUrl } : {}),
        },
      },
    };
    return { success: true as const, data: current };
  });
  const testConnection = vi.fn(async () => ({
    success: true as const,
    data: { provider: 'fixture', resultCount: 1, tookMs: 42 },
  }));
  const gateway: WebSearchSettingsGateway = {
    get: async () => ({ success: true, data: current }),
    set,
    testConnection,
  };
  return { gateway, set, testConnection };
}

function activeView(
  engine: WebSearchEngineId,
  state: WebSearchEngineConfigView,
): WebSearchConfigView {
  return { engine, engines: { [engine]: state } };
}

describe('网络搜索设置编排', () => {
  it('加载已存 BYOK 时不回读 Key，留空保存继续使用原凭证', async () => {
    const fixture = createGateway(activeView('serper', { keySource: 'byok', hasByokKey: true }));
    const settings = useWebSearchSettings(fixture.gateway);
    await settings.load();

    expect(settings.hasStoredKeyForCurrentEngine.value).toBe(true);
    expect(settings.byokKey.value).toBe('');
    await settings.save();

    expect(fixture.set).toHaveBeenCalledWith({ engine: 'serper', keySource: 'byok' });
    expect(settings.feedback.value).toEqual({ kind: 'success', code: 'saved' });
  });

  it('切到付费引擎固定使用 BYOK；缺 Key 时不发 IPC', async () => {
    const fixture = createGateway(activeView('parallel_free', { keySource: 'none', hasByokKey: false }));
    const settings = useWebSearchSettings(fixture.gateway);
    await settings.load();
    settings.selectEngine('serper');
    expect(settings.keySource.value).toBe('byok');

    await settings.testConnection();
    expect(settings.validationError.value).toBe('missing_byok_key');
    expect(fixture.testConnection).not.toHaveBeenCalled();

    settings.byokKey.value = 'new-key';
    await settings.testConnection();
    expect(fixture.testConnection).toHaveBeenCalledWith({
      engine: 'serper',
      keySource: 'byok',
      byokKey: 'new-key',
    });
    expect(settings.feedback.value).toEqual({ kind: 'success', code: 'connection_ok', tookMs: 42 });
  });

  it('SearXNG 地址缺失时阻止保存，填写后只提交 none 组合', async () => {
    const fixture = createGateway(activeView('parallel_free', { keySource: 'none', hasByokKey: false }));
    const settings = useWebSearchSettings(fixture.gateway);
    await settings.load();
    settings.selectEngine('searxng');
    await settings.save();
    expect(settings.validationError.value).toBe('missing_searxng_url');
    expect(fixture.set).not.toHaveBeenCalled();

    settings.searxngBaseUrl.value = 'https://search.example.com';
    await settings.save();
    expect(fixture.set).toHaveBeenCalledWith({
      engine: 'searxng',
      keySource: 'none',
      searxngBaseUrl: 'https://search.example.com',
    });
  });

  it('Jina 与 Tavily 固定使用 BYOK', async () => {
    const fixture = createGateway(activeView('parallel_free', { keySource: 'none', hasByokKey: false }));
    const settings = useWebSearchSettings(fixture.gateway);
    await settings.load();

    settings.selectEngine('jina_search');
    expect(settings.requiresApiKey.value).toBe(true);
    expect(settings.keySource.value).toBe('byok');
    settings.byokKey.value = 'jina-key';
    await settings.save();
    expect(fixture.set).toHaveBeenLastCalledWith({
      engine: 'jina_search',
      keySource: 'byok',
      byokKey: 'jina-key',
    });

    settings.selectEngine('tavily');
    expect(settings.keySource.value).toBe('byok');
  });

  it('切换引擎时恢复各自保存的凭证状态', async () => {
    const fixture = createGateway({
      engine: 'serper',
      engines: {
        serper: { keySource: 'byok', hasByokKey: true },
        tavily: { keySource: 'byok', hasByokKey: true },
      },
    });
    const settings = useWebSearchSettings(fixture.gateway);
    await settings.load();

    expect(settings.keySource.value).toBe('byok');
    settings.selectEngine('tavily');
    expect(settings.keySource.value).toBe('byok');
    expect(settings.hasStoredKeyForCurrentEngine.value).toBe(true);
    await settings.save();
    expect(fixture.set).toHaveBeenCalledWith({ engine: 'tavily', keySource: 'byok' });

    settings.selectEngine('serper');
    expect(settings.hasStoredKeyForCurrentEngine.value).toBe(true);
  });
});
