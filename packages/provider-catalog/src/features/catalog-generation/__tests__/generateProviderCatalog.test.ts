import { describe, expect, it } from 'vitest';
import { ModelsDevSourceSchema } from '../../catalog-admission/definitions/modelsDevSource';
import { generateProviderCatalog } from '../generateProviderCatalog';

function sourceProvider(id: string, models: Record<string, unknown>) {
  return {
    id,
    name: id,
    npm: '@ai-sdk/openai-compatible',
    api: `https://api.${id}.example/v1`,
    models,
  };
}

function sourceModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    tool_call: true,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 256_000, input: 200_000, output: 16_384 },
    ...overrides,
  };
}

function makeSource() {
  return ModelsDevSourceSchema.parse({
    openai: sourceProvider('openai', {
      'gpt-test': sourceModel('gpt-test', {
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      }),
      'gpt-image': sourceModel('gpt-image', {
        modalities: { input: ['text'], output: ['image'] },
        limit: { context: 0, input: 0, output: 0 },
      }),
    }),
    'opencode-go': sourceProvider(
      'opencode-go',
      Object.fromEntries(
        [
          'grok-4.6',
          'gpt-5.6-luna',
          'muse-spark-1.2-contributor',
          'minimax-m3',
          'minimax-m2.7',
          'qwen3.8-max',
          'qwen3.7-max',
          'qwen3.7-plus',
          'qwen3.6-plus',
          'glm-5.3',
        ].map(modelId => [modelId, sourceModel(modelId, { reasoning: true })])
      )
    ),
    anthropic: sourceProvider('anthropic', {
      'claude-test': sourceModel('claude-test'),
    }),
    google: sourceProvider('google', { 'gemini-test': sourceModel('gemini-test') }),
    deepseek: sourceProvider('deepseek', {
      'deepseek-test': sourceModel('deepseek-test', {
        limit: { context: 128_000, input: 256_000, output: 8_192 },
      }),
      'deepseek-old': sourceModel('deepseek-old', { status: 'deprecated' }),
    }),
    moonshotai: sourceProvider('moonshotai', {
      'kimi-test': sourceModel('kimi-test', { status: 'beta' }),
    }),
    alibaba: sourceProvider('alibaba', { 'qwen-test': sourceModel('qwen-test') }),
    minimax: sourceProvider('minimax', { 'minimax-test': sourceModel('minimax-test') }),
    mistral: sourceProvider('mistral', {
      'mistral-test': sourceModel('mistral-test'),
      'mistral-embed': sourceModel('mistral-embed', { tool_call: false }),
    }),
    xai: sourceProvider('xai', {
      'grok-test': sourceModel('grok-test', {
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      }),
      'grok-image': sourceModel('grok-image', { tool_call: false }),
    }),
    groq: sourceProvider('groq', {
      'groq-agent': sourceModel('groq-agent', { reasoning: true }),
      'groq-audio': sourceModel('groq-audio', { tool_call: false }),
    }),
    cerebras: sourceProvider('cerebras', {
      'cerebras-agent': sourceModel('cerebras-agent', { reasoning: true }),
    }),
    openrouter: sourceProvider('openrouter', {
      'openrouter-agent': sourceModel('openrouter-agent', { reasoning: true }),
      'openrouter-image': sourceModel('openrouter-image', { tool_call: false }),
    }),
    'fireworks-ai': sourceProvider('fireworks-ai', {
      'fireworks-agent': sourceModel('fireworks-agent', { reasoning: true }),
    }),
    togetherai: sourceProvider('togetherai', {
      'together-agent': sourceModel('together-agent', { reasoning: true }),
    }),
    deepinfra: sourceProvider('deepinfra', {
      'deepinfra-agent': sourceModel('deepinfra-agent', { reasoning: true }),
      'deepinfra-image': sourceModel('deepinfra-image', { tool_call: false }),
    }),
    cohere: sourceProvider('cohere', {
      'cohere-agent': sourceModel('cohere-agent', { reasoning: true }),
    }),
    siliconflow: sourceProvider('siliconflow', {
      'siliconflow-agent': sourceModel('siliconflow-agent', { reasoning: true }),
    }),
    'siliconflow-cn': sourceProvider('siliconflow-cn', {
      'siliconflow-cn-agent': sourceModel('siliconflow-cn-agent', { reasoning: true }),
    }),
    zai: sourceProvider('zai', {
      'glm-agent': sourceModel('glm-agent', { reasoning: true }),
    }),
    'ollama-cloud': sourceProvider('ollama-cloud', {
      'glm-cloud': sourceModel('glm-cloud', {
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      }),
    }),
    nvidia: sourceProvider('nvidia', {
      'nemotron-agent': sourceModel('nemotron-agent', { reasoning: true }),
      'nvidia-embedding': sourceModel('nvidia-embedding', { tool_call: false }),
    }),
    modelscope: sourceProvider('modelscope', {
      'modelscope-agent': sourceModel('modelscope-agent', { reasoning: true }),
    }),
  });
}

const generation = {
  id: 'fixture-generation',
  source_url: 'https://models.dev/api.json',
  source_sha256: 'a'.repeat(64),
  synced_at: '2026-08-20T00:00:00.000Z',
  policy_version: 1,
} as const;

describe('generateProviderCatalog', () => {
  it('把外部模型事实和 Linnya 已验收 runtime binding 生成成两个投影', () => {
    const projections = generateProviderCatalog(makeSource(), generation);
    const findConnection = (providerId: string, connectionId = providerId) =>
      projections.publicCatalog.providers
        .find(provider => provider.id === providerId)
        ?.connections.find(connection => connection.id === connectionId);
    const openaiBrand = projections.publicCatalog.providers.find(
      provider => provider.id === 'openai'
    );
    const openai = findConnection('openai', 'openai-api');
    const chatgpt = findConnection('openai', 'openai-chatgpt-subscription');
    const opencodeGo = findConnection('opencode-go');
    const deepseek = findConnection('deepseek');
    const cloud = findConnection('linnya-cloud');
    const mistral = findConnection('mistral');
    const xai = findConnection('xai');
    const groq = findConnection('groq');
    const cerebras = findConnection('cerebras');
    const openrouter = findConnection('openrouter');
    const fireworks = findConnection('fireworks');
    const kimiCode = findConnection('moonshot', 'kimi-code');
    const glmCodingPlan = findConnection('zai', 'glm-coding-plan');
    const ollamaBrand = projections.publicCatalog.providers.find(
      provider => provider.id === 'ollama'
    );
    const ollamaLocal = findConnection('ollama');
    const ollamaCloud = findConnection('ollama', 'ollama-cloud');
    const allConnections = projections.publicCatalog.providers.flatMap(
      provider => provider.connections
    );
    const officialProviderCohort = allConnections.filter(connection =>
      ['togetherai', 'deepinfra', 'cohere'].includes(connection.id)
    );
    const compatibleProviders = allConnections.filter(connection =>
      ['siliconflow', 'siliconflow-cn', 'nvidia', 'modelscope'].includes(connection.id)
    );
    const zaiBinding = projections.runtimeBindings.bindings.find(
      binding => binding.provider_connection_definition_id === 'zai-api-global'
    );
    const deepseekBinding = projections.runtimeBindings.bindings.find(
      binding => binding.provider_definition_id === 'deepseek'
    );
    const opencodeGoBinding = projections.runtimeBindings.bindings.find(
      binding => binding.provider_definition_id === 'opencode-go'
    );
    const ollamaCloudBinding = projections.runtimeBindings.bindings.find(
      binding => binding.provider_connection_definition_id === 'ollama-cloud'
    );

    expect(openai?.models).toEqual([
      expect.objectContaining({
        id: 'gpt-test',
        capabilities: { image_input: true, tool_call: true, reasoning: true },
      }),
    ]);
    expect(openaiBrand?.connections.map(connection => connection.id)).toEqual([
      'openai-api',
      'openai-chatgpt-subscription',
    ]);
    expect(ollamaBrand?.connections.map(connection => connection.id)).toEqual([
      'ollama',
      'ollama-cloud',
    ]);
    expect(ollamaLocal).toEqual(
      expect.objectContaining({
        display_name: 'Ollama 本地',
        kind: 'local_runtime',
        model_discovery: 'local_runtime',
      })
    );
    expect(ollamaCloud).toEqual(
      expect.objectContaining({
        display_name: 'Ollama Cloud',
        kind: 'direct',
        model_discovery: 'bundled',
        models: [
          expect.objectContaining({
            id: 'glm-cloud',
            capabilities: { image_input: true, tool_call: true, reasoning: true },
          }),
        ],
      })
    );
    expect(ollamaCloudBinding).toEqual(
      expect.objectContaining({
        default_base_url: 'https://ollama.com',
        default_route_profile_id: 'ollama_chat',
        supported_route_profile_ids: ['ollama_chat'],
      })
    );
    expect(chatgpt).toEqual(
      expect.objectContaining({
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
      })
    );
    expect(kimiCode).toEqual(
      expect.objectContaining({
        display_name: 'Kimi Code',
        badge: '会员',
        setup_help_url: 'https://www.kimi.com/code/docs/',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'k3', context_window_tokens: 1_048_576 }),
          expect.objectContaining({ id: 'k3-256k', context_window_tokens: 262_144 }),
          expect.objectContaining({ id: 'kimi-for-coding' }),
          expect.objectContaining({ id: 'kimi-for-coding-highspeed' }),
        ]),
      })
    );
    expect(glmCodingPlan).toEqual(
      expect.objectContaining({
        display_name: 'GLM Coding Plan',
        release_status: 'hidden',
        models: [
          expect.objectContaining({ id: 'glm-5.3', max_output_tokens: 131_072 }),
          expect.objectContaining({
            id: 'glm-5.3-flash',
            capabilities: expect.objectContaining({ image_input: true }),
          }),
        ],
      })
    );
    expect(
      projections.runtimeBindings.bindings.find(
        binding => binding.provider_connection_definition_id === 'openai-chatgpt-subscription'
      )
    ).toEqual(
      expect.objectContaining({
        default_base_url: 'https://chatgpt.com/backend-api/codex',
        default_route_profile_id: 'chatgpt_codex_responses',
        source_catalog_observation: {
          package_name: '@ai-sdk/openai@4.0.50',
          api_url: 'https://chatgpt.com/backend-api',
        },
      })
    );
    expect(opencodeGo).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'glm-5.3' }),
          expect.objectContaining({ id: 'gpt-5.6-luna' }),
          expect.objectContaining({ id: 'qwen3.8-max' }),
        ]),
      })
    );
    expect(opencodeGoBinding).toEqual(
      expect.objectContaining({
        default_route_profile_id: 'openai_compatible_chat',
        supported_route_profile_ids: [
          'openai_compatible_chat',
          'openai_responses',
          'anthropic_messages',
        ],
        model_route_bindings: expect.arrayContaining([
          expect.objectContaining({
            model_id: 'gpt-5.6-luna',
            route_profile_id: 'openai_responses',
          }),
          expect.objectContaining({
            model_id: 'qwen3.8-max',
            route_profile_id: 'anthropic_messages',
          }),
        ]),
      })
    );
    expect(deepseek?.models).toEqual([
      expect.objectContaining({
        id: 'deepseek-test',
        context_window_tokens: 128_000,
        max_input_tokens: 128_000,
      }),
    ]);
    expect(cloud).toEqual(
      expect.objectContaining({ model_discovery: 'cloud_catalog', models: [] })
    );
    expect(mistral).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'mistral-test' })],
      })
    );
    expect(xai).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [
          expect.objectContaining({
            id: 'grok-test',
            capabilities: { image_input: true, tool_call: true, reasoning: true },
          }),
        ],
      })
    );
    expect(groq).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'groq-agent' })],
      })
    );
    expect(cerebras).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'cerebras-agent' })],
      })
    );
    expect(openrouter).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'openrouter-agent' })],
      })
    );
    expect(fireworks).toEqual(
      expect.objectContaining({
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'fireworks-agent' })],
      })
    );
    expect(officialProviderCohort).toEqual([
      expect.objectContaining({
        id: 'togetherai',
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'together-agent' })],
      }),
      expect.objectContaining({
        id: 'deepinfra',
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'deepinfra-agent' })],
      }),
      expect.objectContaining({
        id: 'cohere',
        release_status: 'preview',
        models: [expect.objectContaining({ id: 'cohere-agent' })],
      }),
    ]);
    expect(
      projections.runtimeBindings.bindings
        .filter(binding =>
          ['togetherai', 'deepinfra', 'cohere'].includes(binding.provider_definition_id)
        )
        .map(binding => binding.default_route_profile_id)
    ).toEqual(['togetherai_chat', 'deepinfra_chat', 'cohere_chat']);
    expect(compatibleProviders).toHaveLength(4);
    expect(compatibleProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'siliconflow', release_status: 'preview' }),
        expect.objectContaining({ id: 'siliconflow-cn', release_status: 'preview' }),
        expect.objectContaining({ id: 'nvidia', release_status: 'preview' }),
        expect.objectContaining({ id: 'modelscope', release_status: 'preview' }),
      ])
    );
    expect(
      projections.runtimeBindings.bindings
        .filter(binding =>
          ['siliconflow', 'siliconflow-cn', 'nvidia', 'modelscope'].includes(
            binding.provider_definition_id
          )
        )
        .map(binding => binding.default_route_profile_id)
    ).toEqual([
      'openai_compatible_chat',
      'openai_compatible_chat',
      'openai_compatible_chat',
      'openai_compatible_chat',
    ]);
    expect(zaiBinding).toEqual(
      expect.objectContaining({
        provider_definition_id: 'zai',
        provider_connection_definition_id: 'zai-api-global',
        default_route_profile_id: 'zai_chat',
      })
    );
    expect(
      projections.runtimeBindings.bindings.find(
        binding => binding.provider_connection_definition_id === 'glm-coding-plan'
      )
    ).toEqual(
      expect.objectContaining({
        default_base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
        default_route_profile_id: 'zai_chat',
      })
    );
    expect(deepseekBinding).toEqual(
      expect.objectContaining({
        default_route_profile_id: 'deepseek_chat',
        source_catalog_observation: {
          package_name: '@ai-sdk/openai-compatible',
          api_url: 'https://api.deepseek.example/v1',
        },
      })
    );
    expect(projections.runtimeBindings.generation_id).toBe(projections.publicCatalog.generation.id);
  });

  it('拒绝已准入 Provider 的 source key/id 分叉', () => {
    const source = makeSource();
    const invalid = ModelsDevSourceSchema.parse({
      ...source,
      deepseek: { ...source.deepseek, id: 'not-deepseek' },
    });
    expect(() => generateProviderCatalog(invalid, generation)).toThrow(/key\/id 不一致/);
  });

  it('严格拒绝被消费的容量关键字段缺失', () => {
    expect(() =>
      ModelsDevSourceSchema.parse({
        openai: sourceProvider('openai', {
          broken: { id: 'broken', name: 'broken', limit: { context: 100 } },
        }),
      })
    ).toThrow();
  });

  it('拒绝已准入 Provider 的非法 API URL 观察值', () => {
    const source = makeSource();
    const invalid = ModelsDevSourceSchema.parse({
      ...source,
      deepseek: { ...source.deepseek, api: '{region}.deepseek.example' },
    });
    expect(() => generateProviderCatalog(invalid, generation)).toThrow(/API URL 非法/);
  });
});
