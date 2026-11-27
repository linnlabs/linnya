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

const noProviderAccounts = {
  resolve: async () => {
    throw new Error('fixture 不使用 Provider account');
  },
};

describe('default inference credential resolver', () => {
  it('本机凭据原样交给推理；缺少凭据投影为推理准入错误', async () => {
    const byokModel = model('byok-model', {
      kind: 'environment_variable',
      environment_variable: 'FIXTURE_API_KEY',
    });
    const resolver = createDefaultInferenceCredentialResolver({
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
    ).rejects.toMatchObject({ name: 'InferenceAdmissionError' });
  });
});
