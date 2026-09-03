import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderCatalogListResponse } from '@app/schemas/provider-catalog';
import type { ProviderCatalogGateway } from '../definitions/providerCatalogGateway';
import { loadProviderCatalog } from './providerCatalogOperations';
import { useProviderCatalogStore } from '../store/providerCatalogStore';

const response: ProviderCatalogListResponse = {
  generation: {
    id: 'test-generation',
    source_url: 'https://models.dev/api.json',
    source_sha256: 'a'.repeat(64),
    synced_at: '2026-08-20T00:00:00.000Z',
    policy_version: 1,
  },
  providers: [
    {
      id: 'openai',
      display_name: 'OpenAI',
      connections: [
        {
          id: 'openai-api',
          display_name: 'OpenAI API',
          kind: 'direct',
          release_status: 'stable',
          setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
          model_discovery: 'bundled',
          models: [],
        },
      ],
    },
  ],
  total: 1,
};

describe('loadProviderCatalog', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('由 orchestration 加载并原子替换 store', async () => {
    const gateway: ProviderCatalogGateway = { load: async () => response };
    await loadProviderCatalog(gateway);
    const store = useProviderCatalogStore();
    expect(store.providers.map(provider => provider.id)).toEqual(['openai']);
    expect(store.generation?.id).toBe('test-generation');
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('加载失败只保存安全错误，不替换旧目录', async () => {
    const store = useProviderCatalogStore();
    store.replaceCatalog(response);
    const gateway: ProviderCatalogGateway = {
      load: async () => {
        throw new Error('catalog unavailable');
      },
    };
    await expect(loadProviderCatalog(gateway)).rejects.toThrow('catalog unavailable');
    expect(store.providers.map(provider => provider.id)).toEqual(['openai']);
    expect(store.error).toBe('catalog unavailable');
  });
});
