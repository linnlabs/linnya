import { describe, expect, it, vi } from 'vitest';
import {
  CustomApiProviderUpdateCommandSchema,
  type CustomApiProviderUpdateRequest,
} from '@app/schemas/custom-api-onboarding';
import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';

import { createCustomApiOnboardingUseCase } from './createCustomApiOnboardingUseCase';

function endpoint(
  id: string,
  overrides: Partial<InferenceEndpointView> = {}
): InferenceEndpointView {
  return {
    id,
    route_profile_id: 'openai_compatible_chat',
    endpoint_id: `custom-openai-compatible:${id}`,
    base_url: 'https://relay.example.com/v1',
    auth_profile: 'bearer',
    credential_reference: { kind: 'stored_secret', credential_id: `inference-endpoint:${id}` },
    credential_status: 'configured',
    ...overrides,
  };
}

function customModel(
  id: string,
  endpointView: InferenceEndpointView,
  providerName: string | undefined,
  options: { readonly imageInput?: boolean } = {}
): ModelConfig {
  return {
    id,
    model_name: `remote-${id}`,
    catalog_source: 'user',
    capabilities: options.imageInput ? ['chat', 'image_input'] : ['chat'],
    ui_visibility: [],
    display_name: `Remote ${id}`,
    description: '用户通过自定义 API 添加的模型',
    billing_mode: 'byok',
    inference_endpoint_id: endpointView.id,
    ...(providerName ? { custom_provider_name: providerName } : {}),
    inference_route: buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: endpointView.endpoint_id,
      endpoint_model_id: `remote-${id}`,
      base_url: endpointView.base_url,
      auth_profile: 'bearer',
      context_window_tokens: 128_000,
      max_output_tokens: 8_192,
      input_support: { user_image: options.imageInput === true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    }),
  };
}

function setup(input: {
  readonly models: readonly ModelConfig[];
  readonly endpoints: readonly InferenceEndpointView[];
  readonly configuredModelIds?: readonly string[];
  readonly ids?: string[];
}) {
  const rebindUserModels = vi.fn(
    async (_models: readonly ModelConfig[], _endpoint: InferenceEndpointSelection) => undefined
  );
  const configuredProvider: ConfiguredProvider = {
    id: 'configured-ollama',
    provider_definition_id: 'ollama',
    provider_connection_definition_id: 'ollama-local',
    models: [],
  };
  const ids = input.ids ?? ['new-endpoint'];
  const useCase = createCustomApiOnboardingUseCase({
    modelCatalog: {
      getModels: () => [...input.models],
      getInferenceEndpoints: () => [...input.endpoints],
      registerUserModel: vi.fn(),
      rebindUserModels,
    },
    providerMembership: {
      getByModelConfigId: modelConfigId =>
        input.configuredModelIds?.includes(modelConfigId) ? configuredProvider : undefined,
    },
    modelPickerPreferences: { setModelVisibility: vi.fn() },
    idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
  });
  return { useCase, rebindUserModels };
}

function admit(request: CustomApiProviderUpdateRequest) {
  return CustomApiProviderUpdateCommandSchema.parse(request);
}

describe('createCustomApiOnboardingUseCase.updateProvider', () => {
  it('只改名时保留原 endpoint 与 route，不触碰凭据', async () => {
    const shared = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', shared, 'Relay'), customModel('b', shared, 'Relay')],
      endpoints: [shared],
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Relay',
          provider_name: 'Relay Prod',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1/',
        })
      )
    ).resolves.toEqual({ provider_name: 'Relay Prod', model_ids: ['a', 'b'] });

    const [models, selection] = rebindUserModels.mock.calls[0] ?? [];
    expect(selection).toEqual({ kind: 'existing', inference_endpoint_id: 'relay' });
    expect(models?.map(model => model.custom_provider_name)).toEqual(['Relay Prod', 'Relay Prod']);
    expect(models?.[0]?.inference_route).toEqual(customModel('a', shared, 'Relay').inference_route);
  });

  it('改地址与格式且未填 Key 时新建 endpoint 并沿用分组唯一可用凭据', async () => {
    const relay = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', relay, 'Relay', { imageInput: true })],
      endpoints: [relay],
    });

    await useCase.updateProvider(
      admit({
        current_provider_name: 'Relay',
        provider_name: 'Relay',
        api_format: 'anthropic_compatible',
        base_url: 'https://claude-relay.example.com',
      })
    );

    const [models, selection] = rebindUserModels.mock.calls[0] ?? [];
    expect(selection).toEqual({
      kind: 'create',
      endpoint: {
        id: 'new-endpoint',
        route_profile_id: 'anthropic_messages',
        endpoint_id: 'custom-anthropic-compatible:new-endpoint',
        base_url: 'https://claude-relay.example.com/v1',
        auth_profile: 'api_key',
        credential_reference: {
          kind: 'stored_secret',
          credential_id: 'inference-endpoint:relay',
        },
      },
    });
    expect(models?.[0]).toMatchObject({
      id: 'a',
      capabilities: ['chat', 'image_input'],
      inference_route: {
        api_surface: 'anthropic_messages',
        endpoint_id: 'custom-anthropic-compatible:new-endpoint',
        endpoint_model_id: 'remote-a',
        base_url: 'https://claude-relay.example.com/v1',
        auth_profile: 'api_key',
        context_window_tokens: 128_000,
        max_output_tokens: 8_192,
        input_support: { user_image: true, tool_result_image: true },
      },
    });
  });

  it('只换 Key 且 endpoint 由本分组独占时在原凭据边界内替换', async () => {
    const relay = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', relay, 'Relay')],
      endpoints: [relay],
    });

    await useCase.updateProvider(
      admit({
        current_provider_name: 'Relay',
        provider_name: 'Relay',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        api_key: 'rotated-secret',
      })
    );

    expect(rebindUserModels.mock.calls[0]?.[1]).toEqual({
      kind: 'existing',
      inference_endpoint_id: 'relay',
      credential_secret: 'rotated-secret',
    });
  });

  it('换 Key 时不影响共享同一 endpoint 的其他分组', async () => {
    const relay = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', relay, 'Relay'), customModel('b', relay, 'Team Relay')],
      endpoints: [relay],
    });

    await useCase.updateProvider(
      admit({
        current_provider_name: 'Relay',
        provider_name: 'Relay',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        api_key: 'rotated-secret',
      })
    );

    const [models, selection] = rebindUserModels.mock.calls[0] ?? [];
    expect(models?.map(model => model.id)).toEqual(['a']);
    expect(selection).toMatchObject({
      kind: 'create',
      endpoint: {
        id: 'new-endpoint',
        endpoint_id: 'custom-openai-compatible:new-endpoint',
        credential_secret: 'rotated-secret',
      },
    });
  });

  it.each([
    {
      name: '原凭据不可用',
      endpoints: [endpoint('relay', { credential_status: 'unavailable' })],
      groups: ['relay'],
    },
    {
      name: '分组跨多个凭据边界',
      endpoints: [endpoint('relay'), endpoint('backup')],
      groups: ['relay', 'backup'],
    },
  ])('$name 时修改地址必须重新填写 Key', async ({ endpoints, groups }) => {
    const { useCase, rebindUserModels } = setup({
      models: groups.map(endpointId =>
        customModel(endpointId, endpoints.find(view => view.id === endpointId)!, 'Relay')
      ),
      endpoints,
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Relay',
          provider_name: 'Relay',
          api_format: 'openai_compatible',
          base_url: 'https://new-relay.example.com/v1',
        })
      )
    ).rejects.toMatchObject({ code: 'custom_api_onboarding.credential_required', statusCode: 400 });
    expect(rebindUserModels).not.toHaveBeenCalled();
  });

  it('不改连接但原凭据不可用时，只改名也要求重新填写 Key', async () => {
    const broken = endpoint('relay', { credential_status: 'missing' });
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', broken, 'Relay')],
      endpoints: [broken],
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Relay',
          provider_name: 'Renamed',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
        })
      )
    ).rejects.toMatchObject({ code: 'custom_api_onboarding.credential_required' });
    expect(rebindUserModels).not.toHaveBeenCalled();
  });

  it('未命名的历史自定义模型归入默认分组，正式 Provider 模型不会被编辑', async () => {
    const relay = endpoint('relay');
    const ollama = endpoint('ollama', { base_url: 'http://127.0.0.1:11434/v1' });
    const { useCase, rebindUserModels } = setup({
      models: [
        customModel('legacy', relay, undefined),
        customModel('ollama-model', ollama, undefined),
      ],
      endpoints: [relay, ollama],
      configuredModelIds: ['ollama-model'],
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: '自定义模型',
          provider_name: 'Relay',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
        })
      )
    ).resolves.toEqual({ provider_name: 'Relay', model_ids: ['legacy'] });
    expect(rebindUserModels.mock.calls[0]?.[0].map(model => model.id)).toEqual(['legacy']);
  });

  it('改成其他分组已使用的名称时拒绝合并', async () => {
    const relay = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', relay, 'Relay'), customModel('b', relay, 'Other')],
      endpoints: [relay],
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Relay',
          provider_name: 'Other',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
        })
      )
    ).rejects.toMatchObject({
      code: 'custom_api_onboarding.provider_name_conflict',
      statusCode: 409,
    });
    expect(rebindUserModels).not.toHaveBeenCalled();
  });

  it('分组不存在或目录写入失败时返回稳定错误', async () => {
    const relay = endpoint('relay');
    const { useCase, rebindUserModels } = setup({
      models: [customModel('a', relay, 'Relay')],
      endpoints: [relay],
    });

    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Missing',
          provider_name: 'Missing',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
        })
      )
    ).rejects.toMatchObject({ code: 'custom_api_onboarding.provider_not_found', statusCode: 404 });

    rebindUserModels.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(
      useCase.updateProvider(
        admit({
          current_provider_name: 'Relay',
          provider_name: 'Relay',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
          api_key: 'rotated-secret',
        })
      )
    ).rejects.toMatchObject({ code: 'custom_api_onboarding.update_failed', statusCode: 500 });
  });
});
