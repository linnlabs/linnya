import { describe, expect, it } from 'vitest';

import type { FormalProviderRuntimeAdmissionInput } from '../definitions/runtimeManifestAdmission';
import { assertFormalProviderRuntimeManifestCovered } from './assertFormalProviderRuntimeManifestCovered';

function validInput(): FormalProviderRuntimeAdmissionInput {
  return {
    bindings: [
      {
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
        endpoint_id: 'openai',
        default_base_url: 'https://api.openai.com/v1',
        auth_profile: 'bearer',
        default_route_profile_id: 'openai_responses',
        supported_route_profile_ids: ['openai_responses', 'openai_chat'],
      },
    ],
    factories: [
      {
        capability_id: 'ai-sdk:openai-responses',
        surface: 'openai_responses',
        auth_profiles: ['bearer'],
      },
      {
        capability_id: 'ai-sdk:openai-chat',
        surface: 'openai_chat_completions',
        auth_profiles: ['bearer'],
      },
    ],
  };
}

describe('assertFormalProviderRuntimeManifestCovered', () => {
  it('接受由已审核 factory 完整覆盖的正式 Provider manifest', () => {
    expect(() => assertFormalProviderRuntimeManifestCovered(validInput())).not.toThrow();
  });

  it('拒绝缺失、重复或 surface/auth 漂移的 factory', () => {
    const input = validInput();
    expect(() =>
      assertFormalProviderRuntimeManifestCovered({
        ...input,
        factories: input.factories.slice(0, 1),
      })
    ).toThrow('openai_chat route 缺少 AI SDK package factory');

    expect(() =>
      assertFormalProviderRuntimeManifestCovered({
        ...input,
        factories: [...input.factories, input.factories[0]],
      })
    ).toThrow('重复的 AI SDK package factory');

    expect(() =>
      assertFormalProviderRuntimeManifestCovered({
        ...input,
        factories: input.factories.map(factory =>
          factory.capability_id === 'ai-sdk:openai-chat'
            ? { ...factory, surface: 'anthropic_messages' }
            : factory
        ),
      })
    ).toThrow('factory surface 不一致');

    expect(() =>
      assertFormalProviderRuntimeManifestCovered({
        ...input,
        factories: input.factories.map(factory =>
          factory.capability_id === 'ai-sdk:openai-chat'
            ? { ...factory, auth_profiles: ['api_key'] }
            : factory
        ),
      })
    ).toThrow('factory auth profile 不一致');
  });
});
