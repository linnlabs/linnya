import { describe, expect, it, vi } from 'vitest';
import { createProviderAccountModelProjection } from './createProviderAccountModelProjection';

describe('Provider account model projection', () => {
  it('把 ChatGPT 账号能力投影成独立图片模型，并在账号移除时撤销', () => {
    const replaceAccountModels = vi.fn();
    const removeAccountModels = vi.fn();
    const projection = createProviderAccountModelProjection({
      modelCatalog: { replaceAccountModels, removeAccountModels },
      runtimeBindings: {
        get: providerConnectionDefinitionId =>
          providerConnectionDefinitionId === 'openai-chatgpt-subscription'
            ? {
                endpoint_id: 'chatgpt-subscription',
                default_base_url: 'https://chatgpt.com/backend-api/codex',
                auth_profile: 'bearer',
              }
            : undefined,
      },
    });

    projection.synchronize('openai-chatgpt-subscription', 'chatgpt-subscription');

    expect(replaceAccountModels).toHaveBeenCalledWith('chatgpt-subscription', [
      expect.objectContaining({
        id: 'chatgpt-subscription-gpt-image-2',
        model_name: 'gpt-image-2',
        display_name: 'gpt-image-2',
        catalog_source: 'account',
        credential_reference: {
          kind: 'provider_account',
          account_id: 'chatgpt-subscription',
        },
        capabilities: ['image_generation'],
        ui_visibility: ['image_generation'],
        image_generation_route: {
          api_surface: 'openai_images_generations',
          capability_id: 'ai-sdk:openai-compatible-image-generation',
          endpoint_id: 'chatgpt-subscription',
          endpoint_model_id: 'gpt-image-2',
          base_url: 'https://chatgpt.com/backend-api/codex',
          auth_profile: 'bearer',
          response_format: 'b64_json',
          max_images_per_call: 1,
        },
      }),
    ]);

    projection.remove('chatgpt-subscription');
    expect(removeAccountModels).toHaveBeenCalledWith('chatgpt-subscription');
  });
});
