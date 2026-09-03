import { describe, expect, it, vi } from 'vitest';

import type { DirectProviderOnboardingGateway } from '../definitions/directProviderOnboardingGateway';
import { connectDirectProvider } from './connectDirectProvider';

describe('connectDirectProvider', () => {
  it('只提交 Provider 与 Key', async () => {
    const connect = vi.fn(async () => ({
      model_ids: ['local-model-1', 'local-model-2'],
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
    }));
    const gateway: DirectProviderOnboardingGateway = { connect };

    await expect(
      connectDirectProvider(
        {
          providerConnectionDefinitionId: 'openai-api',
          apiKey: 'secret-value',
        },
        gateway
      )
    ).resolves.toEqual({ ok: true, modelIds: ['local-model-1', 'local-model-2'] });
    expect(connect).toHaveBeenCalledWith({
      provider_connection_definition_id: 'openai-api',
      api_key: 'secret-value',
    });
  });

  it('表单缺少 Key 时不发请求', async () => {
    const connect = vi.fn();
    const gateway: DirectProviderOnboardingGateway = { connect };
    await expect(
      connectDirectProvider(
        {
          providerConnectionDefinitionId: 'openai-api',
          apiKey: '',
        },
        gateway
      )
    ).resolves.toEqual({ ok: false, issue: 'api_key_required' });
    expect(connect).not.toHaveBeenCalled();
  });
});
