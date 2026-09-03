import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { createDefaultInferenceCredentialResolver } from './createDefaultInferenceCredentialResolver';

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

describe('default inference credential resolver', () => {
  it('host-managed Cloud credential 按 attempt 注入设备身份，BYOK credential 不附带 Cloud header', async () => {
    const cloudModel = model('cloud-model', {
      kind: 'host_managed',
      credential_id: 'linnya-cloud',
    });
    const byokModel = model('byok-model', {
      kind: 'environment_variable',
      environment_variable: 'FIXTURE_API_KEY',
    });
    const resolver = createDefaultInferenceCredentialResolver({
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
});
