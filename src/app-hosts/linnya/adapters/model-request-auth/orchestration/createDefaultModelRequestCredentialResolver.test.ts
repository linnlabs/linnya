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

describe('default model request credential resolver', () => {
  it('只为 host-managed Linnya Cloud credential 动态注入设备身份', async () => {
    const cloudModel = model('cloud-model', {
      kind: 'host_managed',
      credential_id: 'linnya-cloud',
    });
    const byokModel = model('byok-model', {
      kind: 'environment_variable',
      environment_variable: 'FIXTURE_API_KEY',
    });
    const resolver = createDefaultModelRequestCredentialResolver({
      catalog: {
        getModel: id => (id === cloudModel.id ? cloudModel : byokModel),
        getCredentialReference: id =>
          id === cloudModel.id ? cloudModel.credential_reference : byokModel.credential_reference,
        resolveCredential: id => (id === cloudModel.id ? 'linnya-cloud' : 'byok-secret'),
      },
      resolveCloudDeviceId: async () => 'device-fixture',
      providerAccounts: {
        resolve: async () => {
          throw new Error('fixture 不使用 Provider account');
        },
      },
    });

    await expect(
      resolver.resolve({
        model_id: cloudModel.id,
        endpoint_id: 'linnya-cloud',
        auth_profile: 'bearer',
      })
    ).resolves.toEqual({
      profile: 'bearer',
      secret: 'linnya-cloud',
      request_headers: { 'X-Device-ID': 'device-fixture' },
    });
    await expect(
      resolver.resolve({
        model_id: byokModel.id,
        endpoint_id: 'fixture',
        auth_profile: 'bearer',
      })
    ).resolves.toEqual({ profile: 'bearer', secret: 'byok-secret' });
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
      resolveCloudDeviceId: async () => null,
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
