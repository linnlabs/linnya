import { describe, expect, it, vi } from 'vitest';
import {
  CustomApiModelRegistrationCommandSchema,
  type CustomApiModelRegistrationCommand,
  type CustomApiModelRegistrationRequest,
} from '@app/schemas/custom-api-onboarding';
import type { ModelConfig } from 'src/domains/model-catalog';

import type { CustomApiOnboardingModelCatalogPort } from '../definitions/customApiOnboardingPorts';
import { createCustomApiOnboardingUseCase } from './createCustomApiOnboardingUseCase';

function modelCatalog(): CustomApiOnboardingModelCatalogPort & {
  registerUserModel: ReturnType<typeof vi.fn>;
} {
  return {
    getInferenceEndpoints: () => [],
    registerUserModel: vi.fn(async (_model: ModelConfig) => undefined),
  };
}

function admitCommand(
  request: CustomApiModelRegistrationRequest
): CustomApiModelRegistrationCommand {
  return CustomApiModelRegistrationCommandSchema.parse(request);
}

describe('createCustomApiOnboardingUseCase', () => {
  it('把 OpenAI Responses 用户输入投影为完整 route，且不生成 Provider 字段', async () => {
    const catalog = modelCatalog();
    const ids = ['model-local-1', 'endpoint-local-1'];
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.registerModel(
        admitCommand({
          api_format: 'openai_responses',
          base_url: 'http://models.intranet:8080/v1',
          api_key: 'secret-value',
          endpoint_model_id: 'company-gpt',
          context_window_tokens: 256_000,
          max_output_tokens: 16_384,
          supports_image_input: true,
        })
      )
    ).resolves.toEqual({ model_id: 'model-local-1' });

    const [model, endpoint] = catalog.registerUserModel.mock.calls[0] ?? [];
    expect(model).toMatchObject({
      id: 'model-local-1',
      model_name: 'company-gpt',
      capabilities: ['chat', 'image_input'],
      inference_route: {
        api_surface: 'openai_responses',
        capability_id: 'ai-sdk:openai-responses',
        endpoint_id: 'custom-openai-responses:endpoint-local-1',
        base_url: 'http://models.intranet:8080/v1',
        input_support: { user_image: true, tool_result_image: true },
      },
    });
    expect(model).not.toHaveProperty('provider');
    expect(endpoint).toMatchObject({
      kind: 'create',
      endpoint: { id: 'endpoint-local-1', credential_secret: 'secret-value' },
    });
  });

  it('无新 Key 时只复用匹配的自定义 endpoint', async () => {
    const catalog = modelCatalog();
    catalog.getInferenceEndpoints = () => [
      {
        id: 'existing-endpoint',
        route_profile_id: 'anthropic_messages',
        endpoint_id: 'custom-anthropic-compatible:existing-endpoint',
        base_url: 'https://relay.example.com/v1',
        auth_profile: 'api_key',
        credential_reference: {
          kind: 'stored_secret',
          credential_id: 'inference-endpoint:existing-endpoint',
        },
        credential_status: 'configured',
      },
    ];
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      idFactory: { create: () => 'model-local-2' },
    });

    await useCase.registerModel(
      admitCommand({
        api_format: 'anthropic_compatible',
        base_url: 'https://relay.example.com/v1',
        endpoint_model_id: 'claude-compatible',
        context_window_tokens: 200_000,
        max_output_tokens: 16_384,
        supports_image_input: false,
      })
    );

    expect(catalog.registerUserModel.mock.calls[0]?.[1]).toEqual({
      kind: 'existing',
      inference_endpoint_id: 'existing-endpoint',
    });
  });

  it('OpenAI-compatible 模型可声明图片语义能力，但 route 只开放用户图片', async () => {
    const catalog = modelCatalog();
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      idFactory: { create: () => 'openai-compatible-model' },
    });

    await expect(
      useCase.registerModel(
        admitCommand({
          api_format: 'openai_compatible',
          base_url: 'https://api.example.com/v1',
          api_key: 'secret-value',
          endpoint_model_id: 'chat-only-model',
          context_window_tokens: 64_000,
          max_output_tokens: 8_192,
          supports_image_input: true,
        })
      )
    ).resolves.toEqual({ model_id: 'openai-compatible-model' });
    expect(catalog.registerUserModel.mock.calls[0]?.[0]).toMatchObject({
      capabilities: ['chat', 'image_input'],
      inference_route: {
        input_support: { user_image: true, tool_result_image: false },
      },
    });
  });

  it('批量模型共享同一个 endpoint，并返回全部模型身份', async () => {
    const catalog = modelCatalog();
    const ids = ['batch-model-1', 'batch-endpoint', 'batch-model-2'];
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.registerModel(
        admitCommand({
          api_format: 'openai_responses',
          base_url: 'https://batch.example.com/v1',
          api_key: 'secret-value',
          models: [
            {
              endpoint_model_id: 'batch-a',
              context_window_tokens: 64_000,
              max_output_tokens: 8_192,
              supports_image_input: false,
            },
            {
              endpoint_model_id: 'batch-b',
              context_window_tokens: 128_000,
              max_output_tokens: 16_384,
              supports_image_input: true,
            },
          ],
        })
      )
    ).resolves.toEqual({
      model_id: 'batch-model-1',
      model_ids: ['batch-model-1', 'batch-model-2'],
    });

    expect(catalog.registerUserModel).toHaveBeenCalledTimes(2);
    expect(catalog.registerUserModel.mock.calls[0]?.[1]).toMatchObject({
      kind: 'create',
      endpoint: { id: 'batch-endpoint' },
    });
    expect(catalog.registerUserModel.mock.calls[1]?.[1]).toEqual({
      kind: 'existing',
      inference_endpoint_id: 'batch-endpoint',
    });
    expect(catalog.registerUserModel.mock.calls[1]?.[0]).toMatchObject({
      id: 'batch-model-2',
      model_name: 'batch-b',
      capabilities: ['chat', 'image_input'],
      inference_route: { endpoint_id: 'custom-openai-responses:batch-endpoint' },
    });
  });
});
