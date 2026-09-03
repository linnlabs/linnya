import { describe, expect, it } from 'vitest';

import { readFormalProviderRuntimeManifestSnapshot } from './readFormalProviderRuntimeManifestSnapshot';

const SHA = 'a'.repeat(64);

describe('readFormalProviderRuntimeManifestSnapshot', () => {
  it('保留全部已准入 route profile，并删除上游 package 观察值', () => {
    const snapshot = readFormalProviderRuntimeManifestSnapshot({
      schema_version: 2,
      generation_id: 'generation-1',
      source_sha256: SHA,
      bindings: [
        {
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          endpoint_id: 'openai',
          default_base_url: 'https://api.openai.com/v1/',
          auth_profile: 'bearer',
          default_route_profile_id: 'openai_responses',
          supported_route_profile_ids: ['openai_responses', 'openai_chat'],
          model_route_bindings: [
            {
              model_id: 'gpt-chat',
              base_url: 'https://api.openai.com/v1/',
              route_profile_id: 'openai_chat',
            },
          ],
          source_catalog_observation: { package_name: '@ai-sdk/openai' },
        },
      ],
    });

    expect(snapshot.bindings).toEqual([
      {
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
        endpoint_id: 'openai',
        default_base_url: 'https://api.openai.com/v1',
        auth_profile: 'bearer',
        default_route_profile_id: 'openai_responses',
        supported_route_profile_ids: ['openai_responses', 'openai_chat'],
        model_route_bindings: [
          {
            model_id: 'gpt-chat',
            base_url: 'https://api.openai.com/v1',
            route_profile_id: 'openai_chat',
          },
        ],
      },
    ]);
  });

  it('拒绝任一已声明 route 与认证合同不一致的生成资产', () => {
    expect(() =>
      readFormalProviderRuntimeManifestSnapshot({
        schema_version: 2,
        generation_id: 'generation-1',
        source_sha256: SHA,
        bindings: [
          {
            provider_definition_id: 'anthropic',
            provider_connection_definition_id: 'anthropic',
            endpoint_id: 'anthropic',
            default_base_url: 'https://api.anthropic.com/v1',
            auth_profile: 'bearer',
            default_route_profile_id: 'anthropic_messages',
            supported_route_profile_ids: ['anthropic_messages', 'google_generative_ai'],
            source_catalog_observation: { package_name: '@ai-sdk/anthropic' },
          },
        ],
      })
    ).toThrow('auth profile 与 google_generative_ai route profile 不一致');
  });

  it('拒绝默认 route 不在支持列表或支持列表重复', () => {
    const binding = {
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      endpoint_id: 'openai',
      default_base_url: 'https://api.openai.com/v1',
      auth_profile: 'bearer',
      default_route_profile_id: 'openai_responses',
      source_catalog_observation: { package_name: '@ai-sdk/openai' },
    } as const;

    expect(() =>
      readFormalProviderRuntimeManifestSnapshot({
        schema_version: 2,
        generation_id: 'generation-1',
        source_sha256: SHA,
        bindings: [{ ...binding, supported_route_profile_ids: ['openai_chat'] }],
      })
    ).toThrow('默认 route profile 不在支持列表中');

    expect(() =>
      readFormalProviderRuntimeManifestSnapshot({
        schema_version: 2,
        generation_id: 'generation-1',
        source_sha256: SHA,
        bindings: [
          {
            ...binding,
            supported_route_profile_ids: ['openai_responses', 'openai_responses'],
          },
        ],
      })
    ).toThrow('重复的 supported route profile');
  });
});
