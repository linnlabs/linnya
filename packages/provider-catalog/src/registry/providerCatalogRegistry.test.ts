import { describe, expect, it } from 'vitest';
import runtimeBindings from '../generated/provider-runtime-bindings.generated.json';
import publicCatalogAsset from '../generated/provider-catalog.generated.json';
import { providerCatalog } from './providerCatalogRegistry';

describe('providerCatalog', () => {
  it('从唯一离线生成资产提供 list/get/search', () => {
    expect(providerCatalog.get('openai')?.display_name).toBe('OpenAI');
    expect(providerCatalog.get('openai')?.connections.map(connection => connection.id)).toEqual([
      'openai-api',
      'openai-chatgpt-subscription',
    ]);
    expect(providerCatalog.getConnection('openai-chatgpt-subscription')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'ChatGPT 订阅',
        setup_fields: [expect.objectContaining({ kind: 'oauth' })],
      })
    );
    expect(providerCatalog.search('deepseek').map(provider => provider.id)).toContain('deepseek');
    expect(providerCatalog.search('claude').map(provider => provider.id)).toContain('anthropic');
    expect(providerCatalog.getConnection('mistral')?.connection).toEqual(
      expect.objectContaining({
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('xai')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'xAI',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('groq')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'Groq',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('cerebras')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'Cerebras',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('openrouter')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'OpenRouter',
        setup_help_url: 'https://openrouter.ai/settings/keys',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('deepseek')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'DeepSeek',
        setup_help_url: 'https://platform.deepseek.com/api_keys',
      })
    );
    expect(providerCatalog.getConnection('fireworks')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'Fireworks AI',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('togetherai')?.connection).toEqual(
      expect.objectContaining({ display_name: 'Together AI', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('deepinfra')?.connection).toEqual(
      expect.objectContaining({ display_name: 'DeepInfra', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('cohere')?.connection).toEqual(
      expect.objectContaining({ display_name: 'Cohere', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('siliconflow')?.connection).toEqual(
      expect.objectContaining({ display_name: 'SiliconFlow', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('siliconflow-cn')?.connection).toEqual(
      expect.objectContaining({ display_name: 'SiliconFlow (China)', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('zai-api-global')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'Z.AI API（国际站）',
        setup_help_url: 'https://z.ai/manage-apikey/apikey-list',
        release_status: 'preview',
      })
    );
    expect(providerCatalog.getConnection('kimi-code')?.connection).toEqual(
      expect.objectContaining({ display_name: 'Kimi Code', badge: '会员' })
    );
    expect(providerCatalog.getConnection('moonshot-api-cn')?.connection).toEqual(
      expect.objectContaining({
        display_name: 'Kimi 开放平台 API（中国站）',
        setup_help_url: 'https://platform.moonshot.cn/console/api-keys',
      })
    );
    expect(providerCatalog.getConnection('zhipu-api-cn')?.connection).toEqual(
      expect.objectContaining({
        display_name: '智谱开放平台 API（中国站）',
        setup_help_url: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
      })
    );
    expect(providerCatalog.getConnection('glm-coding-plan')).toBeUndefined();
    expect(providerCatalog.getConnection('nvidia')?.connection).toEqual(
      expect.objectContaining({ display_name: 'NVIDIA NIM', release_status: 'preview' })
    );
    expect(providerCatalog.getConnection('modelscope')?.connection).toEqual(
      expect.objectContaining({ display_name: 'ModelScope', release_status: 'preview' })
    );
  });

  it('公开目录不泄露 runtime package、route 或认证实现', () => {
    const serialized = JSON.stringify(publicCatalogAsset);
    expect(serialized).not.toContain('package_name');
    expect(serialized).not.toContain('capability_id');
    expect(serialized).not.toContain('api_surface');
    expect(serialized).not.toContain('auth_profile');
  });

  it('公开目录和 Host runtime binding 来自同一代 source', () => {
    expect(runtimeBindings.generation_id).toBe(publicCatalogAsset.generation.id);
    expect(runtimeBindings.source_sha256).toBe(publicCatalogAsset.generation.source_sha256);
    expect(
      runtimeBindings.bindings.find(binding => binding.provider_definition_id === 'deepseek')
        ?.default_route_profile_id
    ).toBe('deepseek_chat');
  });
});
