import { describe, expect, it } from 'vitest';

import type { FormalProviderRuntimeBinding } from '@linnya/provider-catalog/runtime-bindings';
import { projectByokLiveSmokeTargetDescriptors } from './projectByokLiveSmokeTargetDescriptors';

describe('projectByokLiveSmokeTargetDescriptors', () => {
  it('从 Provider 与 route profile 身份派生 target 和环境变量', () => {
    const binding: FormalProviderRuntimeBinding = {
      provider_definition_id: 'openai',
      endpoint_id: 'openai',
      default_base_url: 'https://api.openai.com/v1',
      auth_profile: 'bearer',
      default_route_profile_id: 'openai_responses',
      supported_route_profile_ids: ['openai_responses', 'openai_chat'],
    };

    expect(projectByokLiveSmokeTargetDescriptors([binding])).toEqual([
      expect.objectContaining({
        id: 'openai-responses',
        capability_id: 'ai-sdk:openai-responses',
        modelEnvironmentVariable: 'LINNYA_BYOK_OPENAI_RESPONSES_MODEL',
        credentialEnvironmentVariable: 'LINNYA_BYOK_OPENAI_API_KEY',
      }),
      expect.objectContaining({
        id: 'openai-chat',
        capability_id: 'ai-sdk:openai-chat',
        modelEnvironmentVariable: 'LINNYA_BYOK_OPENAI_CHAT_MODEL',
        credentialEnvironmentVariable: 'LINNYA_BYOK_OPENAI_API_KEY',
      }),
    ]);
  });

  it('单 route Provider 直接使用 Provider id，且拒绝非 BYOK 绑定', () => {
    const binding: FormalProviderRuntimeBinding = {
      provider_definition_id: 'deepseek',
      endpoint_id: 'deepseek',
      default_base_url: 'https://api.deepseek.com',
      auth_profile: 'bearer',
      default_route_profile_id: 'deepseek_chat',
      supported_route_profile_ids: ['deepseek_chat'],
    };

    expect(projectByokLiveSmokeTargetDescriptors([binding])).toEqual([
      expect.objectContaining({
        id: 'deepseek',
        modelEnvironmentVariable: 'LINNYA_BYOK_DEEPSEEK_MODEL',
        baseUrlEnvironmentVariable: 'LINNYA_BYOK_DEEPSEEK_BASE_URL',
      }),
    ]);
    expect(() =>
      projectByokLiveSmokeTargetDescriptors([{ ...binding, auth_profile: 'none' }])
    ).toThrow('没有凭据，不能进入 BYOK live smoke');
  });

  it('同一 Provider 的多个正式连接使用 endpoint 身份，不生成歧义 target', () => {
    const base: FormalProviderRuntimeBinding = {
      provider_definition_id: 'moonshot',
      provider_connection_definition_id: 'moonshot-api-global',
      endpoint_id: 'moonshotai',
      default_base_url: 'https://api.moonshot.ai/v1',
      auth_profile: 'bearer',
      default_route_profile_id: 'moonshot_chat',
      supported_route_profile_ids: ['moonshot_chat'],
    };

    expect(
      projectByokLiveSmokeTargetDescriptors([
        base,
        {
          ...base,
          provider_connection_definition_id: 'moonshot-api-cn',
          endpoint_id: 'moonshotai-cn',
          default_base_url: 'https://api.moonshot.cn/v1',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'moonshotai',
        credentialEnvironmentVariable: 'LINNYA_BYOK_MOONSHOTAI_API_KEY',
      }),
      expect.objectContaining({
        id: 'moonshotai-cn',
        credentialEnvironmentVariable: 'LINNYA_BYOK_MOONSHOTAI_CN_API_KEY',
      }),
    ]);
  });
});
