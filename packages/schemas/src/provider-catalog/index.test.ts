import { describe, expect, it } from 'vitest';
import {
  ProviderCatalogGetResponseSchema,
  ProviderCatalogListResponseSchema,
  ProviderCatalogSnapshotSchema,
  projectLegacyProviderConnectionIdentity,
} from './index';

const generation = {
  id: 'test-generation',
  source_url: 'https://models.dev/api.json',
  source_sha256: 'a'.repeat(64),
  synced_at: '2026-08-20T00:00:00.000Z',
  policy_version: 1,
};

const provider = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [
    {
      id: 'openai-api',
      display_name: 'OpenAI API',
      description: '按量计费，使用 OpenAI Platform API Key',
      badge: 'API',
      setup_help_url: 'https://platform.openai.com/api-keys',
      kind: 'direct',
      release_status: 'stable',
      setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
      model_discovery: 'bundled',
      models: [
        {
          id: 'gpt-test',
          display_name: 'GPT Test',
          release_status: 'active',
          context_window_tokens: 256_000,
          max_input_tokens: 200_000,
          max_output_tokens: 16_384,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        },
      ],
    },
  ],
};

describe('Provider Catalog wire schema', () => {
  it('同一合同解析生成资产、list 和 get 响应', () => {
    expect(
      ProviderCatalogSnapshotSchema.parse({ schema_version: 2, generation, providers: [provider] })
        .providers[0].id
    ).toBe('openai');
    expect(
      ProviderCatalogListResponseSchema.parse({ generation, providers: [provider], total: 1 }).total
    ).toBe(1);
    expect(ProviderCatalogGetResponseSchema.parse({ generation, provider }).provider.id).toBe(
      'openai'
    );
  });

  it('正式账号型 Provider 只向 Renderer 暴露授权动作，不暴露协议或凭据', () => {
    const chatgpt = ProviderCatalogGetResponseSchema.parse({
      generation,
      provider: {
        ...provider,
        connections: [
          ...provider.connections,
          {
            id: 'openai-chatgpt-subscription',
            display_name: 'ChatGPT 订阅',
            kind: 'direct',
            release_status: 'preview',
            setup_fields: [
              {
                id: 'authorization',
                kind: 'oauth',
                required: true,
                label: '使用 ChatGPT 登录',
              },
            ],
            model_discovery: 'account_catalog',
            models: [],
          },
        ],
      },
    }).provider;
    const chatgptConnection = chatgpt.connections[1];

    expect(chatgptConnection?.setup_fields).toEqual([
      expect.objectContaining({ kind: 'oauth', label: '使用 ChatGPT 登录' }),
    ]);
    expect(chatgpt).not.toHaveProperty('route_profile_id');
    expect(chatgpt).not.toHaveProperty('credential');
  });

  it('拒绝容量分叉、total 漂移和 runtime 私有字段', () => {
    expect(() =>
      ProviderCatalogListResponseSchema.parse({ generation, providers: [provider], total: 2 })
    ).toThrow(/total/);
    expect(() =>
      ProviderCatalogGetResponseSchema.parse({
        generation,
        provider: {
          ...provider,
          connections: [{ ...provider.connections[0], auth_profile: 'bearer' }],
        },
      })
    ).toThrow();
    expect(() =>
      ProviderCatalogGetResponseSchema.parse({
        generation,
        provider: {
          ...provider,
          connections: [
            {
              ...provider.connections[0],
              models: [
                {
                  ...provider.connections[0].models[0],
                  max_input_tokens: 300_000,
                },
              ],
            },
          ],
        },
      })
    ).toThrow(/max_input_tokens/);
  });

  it('只按冻结映射迁移旧 Provider identity，不从运行时事实补猜', () => {
    expect(projectLegacyProviderConnectionIdentity('chatgpt')).toEqual({
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
    });
    expect(projectLegacyProviderConnectionIdentity('anthropic')).toEqual({
      provider_definition_id: 'anthropic',
      provider_connection_definition_id: 'anthropic',
    });
  });
});
