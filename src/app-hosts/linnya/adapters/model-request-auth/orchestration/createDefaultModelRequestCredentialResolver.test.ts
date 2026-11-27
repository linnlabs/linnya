import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { createDefaultModelRequestCredentialResolver } from './createDefaultModelRequestCredentialResolver';

function model(id: string, credentialReference: ModelConfig['credential_reference']): ModelConfig {
  return {
    id,
    model_name: 'mock-chat',
    catalog_source: 'default',
    credential_reference: credentialReference,
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Canonical mock',
    description: 'Credential resolution fixture',
  };
}

const noProviderAccounts = {
  resolve: async () => {
    throw new Error('fixture 不使用 Provider account');
  },
};

describe('default model request credential resolver', () => {
  it('本机凭据只返回 profile 与 secret，未配置时在请求前拒绝', async () => {
    const byokModel = model('byok-model', {
      kind: 'environment_variable',
      environment_variable: 'FIXTURE_API_KEY',
    });
    const resolver = createDefaultModelRequestCredentialResolver({
      catalog: {
        getModel: () => byokModel,
        getCredentialReference: () => byokModel.credential_reference,
        resolveCredential: id => (id === byokModel.id ? 'byok-secret' : undefined),
      },
      providerAccounts: noProviderAccounts,
    });

    await expect(
      resolver.resolve({ model_id: byokModel.id, endpoint_id: 'fixture', auth_profile: 'bearer' })
    ).resolves.toEqual({ profile: 'bearer', secret: 'byok-secret' });
    await expect(
      resolver.resolve({ model_id: 'missing-model', endpoint_id: 'fixture', auth_profile: 'bearer' })
    ).rejects.toThrow('Model request credential is not configured for model: missing-model');
  });

  it('Provider account 由账号边界解析 access token 与附属请求头', async () => {
    const accountModel = model('chatgpt-model', undefined);
    const resolver = createDefaultModelRequestCredentialResolver({
      catalog: {
        getModel: () => accountModel,
        getCredentialReference: () => ({
          kind: 'provider_account',
          account_id: 'chatgpt-subscription',
        }),
        resolveCredential: () => {
          throw new Error('Model Catalog 不得解密 Provider account');
        },
      },
      providerAccounts: {
        resolve: async () => ({
          access_token: 'oauth-access-token',
          request_headers: {
            'chatgpt-account-id': 'account-1',
            originator: 'linnya',
          },
        }),
      },
    });

    await expect(
      resolver.resolve({
        model_id: accountModel.id,
        endpoint_id: 'chatgpt-subscription',
        auth_profile: 'bearer',
      })
    ).resolves.toEqual({
      profile: 'bearer',
      secret: 'oauth-access-token',
      request_headers: {
        'chatgpt-account-id': 'account-1',
        originator: 'linnya',
      },
    });
  });
});
