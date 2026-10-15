import { describe, expect, it, vi } from 'vitest';
import {
  CustomApiModelRegistrationCommandSchema,
  type CustomApiModelRegistrationCommand,
  type CustomApiModelRegistrationRequest,
} from '@app/schemas/custom-api-onboarding';
import type { ModelConfig } from 'src/domains/model-catalog';
import {
  ModelPickerPreferencesRegistry,
  type ModelPickerPreferencesRepository,
  type ModelPickerPreferencesSnapshot,
} from 'src/domains/model-picker-preferences';
import { composeSelectableModelMenu } from '../../model-picker';

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

function pickerPreferencesRepository(): ModelPickerPreferencesRepository {
  let saved: ModelPickerPreferencesSnapshot = {
    provider_preferences: [],
    model_preferences: [],
  };
  return {
    async load() {
      return structuredClone(saved);
    },
    async save(snapshot) {
      saved = structuredClone(snapshot);
    },
  };
}

describe('createCustomApiOnboardingUseCase', () => {
  it('把 OpenAI Responses 用户输入投影为完整 route，且不生成 Provider 字段', async () => {
    const catalog = modelCatalog();
    const ids = ['model-local-1', 'endpoint-local-1'];
    const setModelVisibility = vi.fn();
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      modelPickerPreferences: { setModelVisibility },
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
    expect(setModelVisibility).not.toHaveBeenCalled();
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
      modelPickerPreferences: { setModelVisibility: vi.fn() },
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
      modelPickerPreferences: { setModelVisibility: vi.fn() },
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
      modelPickerPreferences: { setModelVisibility: vi.fn() },
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

  it.each([
    { name: '部分关闭并保留未指定模型的默认值', selections: [true, false, undefined] },
    { name: '全部关闭', selections: [false, false, false] },
  ])('$name：注册后和偏好重新加载后都保留选择', async ({ selections }) => {
    const repository = pickerPreferencesRepository();
    const preferences = new ModelPickerPreferencesRegistry(repository);
    await preferences.initialize({ configured_provider_ids: [], model_config_ids: [] });
    const models: ModelConfig[] = [];
    let nextId = 0;
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: {
        getInferenceEndpoints: () => [],
        async registerUserModel(model) {
          // Catalog 一旦暴露模型，关闭偏好就应已提交，不能短暂变为默认开启。
          const index = models.length;
          const preference = preferences.read().model_preferences.find(
            item => item.model_config_id === model.id
          );
          expect(preference?.visible).toBe(selections[index]);
          models.push(model);
        },
      },
      modelPickerPreferences: preferences,
      idFactory: { create: () => `custom-${++nextId}` },
    });

    await useCase.registerModel(
      admitCommand({
        api_format: 'openai_compatible',
        base_url: 'https://models.example.com/v1',
        api_key: 'secret-value',
        models: selections.map((enabled, index) => ({
          endpoint_model_id: `remote-${index}`,
          context_window_tokens: 64_000,
          max_output_tokens: 8_192,
          supports_image_input: false,
          ...(enabled !== undefined ? { picker_enabled: enabled } : {}),
        })),
      })
    );

    expect(models).toHaveLength(selections.length);
    const reloaded = new ModelPickerPreferencesRegistry(repository);
    await reloaded.initialize({
      configured_provider_ids: [],
      model_config_ids: models.map(model => model.id),
    });

    for (const registry of [preferences, reloaded]) {
      const menu = composeSelectableModelMenu({
        discovered_models: { read: () => undefined },
        can_refresh_models: () => false,
        provider_definitions: [],
        configured_providers: [],
        models,
        inference_endpoints: [],
        provider_accounts: [],
        preferences: registry.read(),
        has_credential: () => false,
        has_provider_account_credential: () => false,
        get_credential_status: () => 'missing',
        get_provider_account_credential_status: () => 'missing',
      });
      const expected = selections.map(enabled => enabled ?? true);
      expect(menu.custom_models.map(model => model.picker_enabled)).toEqual(expected);
      expect(menu.custom_providers?.[0]?.models.map(model => model.picker_enabled)).toEqual(
        expected
      );
      expect(registry.read().model_preferences).toHaveLength(
        selections.filter(enabled => enabled !== undefined).length
      );
    }
  });

  it.each(['偏好', '目录'])('%s 保存失败时明确失败，启动时清理未注册模型的偏好', async stage => {
    const catalog = modelCatalog();
    const repository = pickerPreferencesRepository();
    const preferences = new ModelPickerPreferencesRegistry(repository);
    await preferences.initialize({ configured_provider_ids: [], model_config_ids: [] });
    if (stage === '偏好') {
      vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('偏好文件无法写入'));
    } else {
      catalog.registerUserModel.mockRejectedValueOnce(new Error('模型目录无法写入'));
    }
    const useCase = createCustomApiOnboardingUseCase({
      modelCatalog: catalog,
      modelPickerPreferences: preferences,
      idFactory: { create: () => 'custom-model' },
    });

    await expect(
      useCase.registerModel(
        admitCommand({
          api_format: 'openai_compatible',
          base_url: 'https://models.example.com/v1',
          api_key: 'secret-value',
          models: [
            {
              endpoint_model_id: 'remote-model',
              context_window_tokens: 64_000,
              max_output_tokens: 8_192,
              supports_image_input: false,
              picker_enabled: false,
            },
          ],
        })
      )
    ).rejects.toMatchObject({ code: 'custom_api_onboarding.registration_failed' });
    expect(catalog.registerUserModel).toHaveBeenCalledTimes(stage === '偏好' ? 0 : 1);
    const reloaded = new ModelPickerPreferencesRegistry(repository);
    await reloaded.initialize({ configured_provider_ids: [], model_config_ids: [] });
    expect(reloaded.read().model_preferences).toEqual([]);
  });
});
