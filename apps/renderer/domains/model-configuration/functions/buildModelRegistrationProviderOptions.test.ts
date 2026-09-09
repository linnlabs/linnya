import { describe, expect, it } from 'vitest';
import type { ProviderDefinition } from '../features/provider-catalog';
import {
  buildModelRegistrationCommonProviderOptions,
  buildModelRegistrationConnectionOptions,
  buildModelRegistrationOtherProviderOptions,
  buildModelRegistrationProviderOptions,
  resolveAccountProviderConnectionDefinitionId,
  resolveApiKeyProviderConnectionDefinitionId,
  resolveLocalRuntimeProviderConnectionDefinitionId,
} from './buildModelRegistrationProviderOptions';

const providerModel = {
  id: 'gpt-test',
  display_name: 'GPT Test',
  release_status: 'active',
  context_window_tokens: 256_000,
  max_input_tokens: 240_000,
  max_output_tokens: 16_384,
  capabilities: { image_input: true, tool_call: true, reasoning: true },
} as const;

const openAiProvider = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [
    {
      id: 'openai-api',
      display_name: 'OpenAI API',
      description: '按量计费，使用 OpenAI Platform API Key',
      badge: 'API',
      kind: 'direct',
      release_status: 'stable',
      setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
      model_discovery: 'bundled',
      models: [providerModel],
    },
    {
      id: 'openai-chatgpt-subscription',
      display_name: 'ChatGPT 订阅',
      description: '使用 ChatGPT 订阅额度，通过浏览器登录',
      badge: '订阅',
      kind: 'direct',
      release_status: 'preview',
      setup_fields: [
        { id: 'authorization', kind: 'oauth', required: true, label: '使用 ChatGPT 登录' },
      ],
      model_discovery: 'account_catalog',
      models: [],
    },
  ],
} satisfies ProviderDefinition;

const anthropicProvider = {
  id: 'anthropic',
  display_name: 'Anthropic',
  connections: [
    {
      id: 'anthropic',
      display_name: 'Anthropic',
      kind: 'direct',
      release_status: 'stable',
      setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
      model_discovery: 'bundled',
      models: [providerModel],
    },
  ],
} satisfies ProviderDefinition;

const ollamaProvider = {
  id: 'ollama',
  display_name: 'Ollama',
  connections: [
    {
      id: 'ollama',
      display_name: 'Ollama 本地',
      kind: 'local_runtime',
      release_status: 'stable',
      setup_fields: [
        {
          id: 'service_url',
          kind: 'url',
          required: true,
          label: '服务地址',
          default_value: 'http://127.0.0.1:11434',
        },
      ],
      model_discovery: 'local_runtime',
      models: [],
    },
    {
      id: 'ollama-cloud',
      display_name: 'Ollama Cloud',
      kind: 'direct',
      release_status: 'preview',
      setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
      model_discovery: 'bundled',
      models: [providerModel],
    },
  ],
} satisfies ProviderDefinition;

describe('model registration Provider options', () => {
  it('首屏优先展示常用 Provider，并让 Ollama Cloud 直达对应接入方式', () => {
    expect(
      buildModelRegistrationCommonProviderOptions([
        openAiProvider,
        ollamaProvider,
        anthropicProvider,
      ])
    ).toEqual([
      { value: 'provider:openai', text: 'OpenAI' },
      {
        value: 'provider:ollama',
        text: 'Ollama Cloud',
        preferredConnectionDefinitionId: 'ollama-cloud',
      },
      { value: 'provider:anthropic', text: 'Claude' },
    ]);
  });

  it('Ollama Cloud 已配置时仍保留 Ollama 本地入口', () => {
    expect(
      buildModelRegistrationCommonProviderOptions(
        [ollamaProvider],
        new Set(['ollama-cloud'])
      )
    ).toEqual([{ value: 'provider:ollama', text: 'Ollama' }]);
    expect(
      buildModelRegistrationOtherProviderOptions([ollamaProvider], new Set(['ollama-cloud']))
    ).toEqual([]);
  });

  it('其他供应商下拉保留完整目录但不重复首屏品牌', () => {
    const deepseekProvider = {
      id: 'deepseek',
      display_name: 'DeepSeek',
      connections: [
        {
          id: 'deepseek',
          display_name: 'DeepSeek',
          kind: 'direct',
          release_status: 'stable',
          setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
          model_discovery: 'bundled',
          models: [providerModel],
        },
      ],
    } satisfies ProviderDefinition;

    expect(
      buildModelRegistrationOtherProviderOptions([
        openAiProvider,
        anthropicProvider,
        deepseekProvider,
        ollamaProvider,
      ])
    ).toEqual([
      { value: 'provider:deepseek', text: 'DeepSeek' },
    ]);
  });

  it('品牌只出现一次，并在第二步列出同品牌的 API 与订阅接入方式', () => {
    const unsupportedProvider = {
      id: 'empty-provider',
      display_name: 'Empty Provider',
      connections: [
        {
          id: 'empty-provider',
          display_name: 'Empty Provider API',
          kind: 'direct',
          release_status: 'stable',
          setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
          model_discovery: 'bundled',
          models: [],
        },
      ],
    } satisfies ProviderDefinition;

    expect(
      buildModelRegistrationProviderOptions([openAiProvider, unsupportedProvider, ollamaProvider], {
        custom: '自定义 Provider',
      })
    ).toEqual([
      { value: 'custom', text: '自定义 Provider' },
      { value: 'provider:openai', text: 'OpenAI' },
      { value: 'provider:ollama', text: 'Ollama' },
    ]);
    expect(buildModelRegistrationConnectionOptions('provider:openai', [openAiProvider])).toEqual([
      {
        value: 'connection:openai-api',
        label: 'OpenAI API',
        description: '按量计费，使用 OpenAI Platform API Key',
        badge: 'API',
      },
      {
        value: 'connection:openai-chatgpt-subscription',
        label: 'ChatGPT 订阅',
        description: '使用 ChatGPT 订阅额度，通过浏览器登录',
        badge: '订阅',
      },
    ]);
    expect(buildModelRegistrationConnectionOptions('provider:ollama', [ollamaProvider])).toEqual([
      { value: 'connection:ollama', label: 'Ollama 本地' },
      { value: 'connection:ollama-cloud', label: 'Ollama Cloud' },
    ]);
    expect(
      buildModelRegistrationConnectionOptions(
        'provider:openai',
        [openAiProvider],
        new Set(['openai-api'])
      )
    ).toEqual([
      {
        value: 'connection:openai-chatgpt-subscription',
        label: 'ChatGPT 订阅',
        description: '使用 ChatGPT 订阅额度，通过浏览器登录',
        badge: '订阅',
      },
    ]);
  });

  it('只有第二步接入方式选择才投影 connection definition id', () => {
    expect(
      resolveApiKeyProviderConnectionDefinitionId('provider:openai', [openAiProvider])
    ).toBeUndefined();
    expect(
      resolveApiKeyProviderConnectionDefinitionId('connection:openai-api', [openAiProvider])
    ).toBe('openai-api');
    expect(
      resolveAccountProviderConnectionDefinitionId('connection:openai-chatgpt-subscription', [
        openAiProvider,
      ])
    ).toBe('openai-chatgpt-subscription');
    expect(
      resolveLocalRuntimeProviderConnectionDefinitionId('connection:ollama', [ollamaProvider])
    ).toBe('ollama');
    expect(
      resolveApiKeyProviderConnectionDefinitionId('connection:ollama-cloud', [ollamaProvider])
    ).toBe('ollama-cloud');
  });
});
