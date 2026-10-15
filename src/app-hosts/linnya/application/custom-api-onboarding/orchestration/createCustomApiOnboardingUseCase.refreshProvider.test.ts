import { describe, expect, it, vi } from 'vitest';
import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import {
  ModelDiscoveryService,
  ModelCatalogConflictError,
  type UserModelRegistration,
  type InferenceEndpointView,
  type ModelConfig,
} from 'src/domains/model-catalog';
import {
  ModelPickerPreferencesRegistry,
  type ModelPickerPreferencesSnapshot,
} from 'src/domains/model-picker-preferences';

import { createCustomApiOnboardingUseCase } from './createCustomApiOnboardingUseCase';

const connection: InferenceEndpointView = {
  id: 'relay-endpoint',
  route_profile_id: 'openai_compatible_chat',
  endpoint_id: 'custom-openai-compatible:relay-endpoint',
  base_url: 'https://relay.example.com/v1',
  auth_profile: 'bearer',
  credential_reference: { kind: 'stored_secret', credential_id: 'relay-key' },
  credential_status: 'configured',
};

function configuredModel(id: string, endpoint = connection): ModelConfig {
  return {
    id,
    model_name: `display-${id}`,
    display_name: `My ${id}`,
    catalog_source: 'user',
    custom_provider_name: 'Relay',
    capabilities: ['chat'],
    ui_visibility: [],
    description: '自定义模型',
    billing_mode: 'byok',
    inference_endpoint_id: endpoint.id,
    inference_route: buildModelInferenceRoute({
      profile_id: endpoint.route_profile_id,
      endpoint_id: endpoint.endpoint_id,
      endpoint_model_id: `remote-${id}`,
      base_url: endpoint.base_url,
      auth_profile: endpoint.auth_profile,
      context_window_tokens: 64_000,
      max_output_tokens: 8_192,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    }),
  };
}

async function setup(fetchFn: typeof fetch, endpoints = [connection]) {
  const models = endpoints.map((endpoint, index) => configuredModel(`local-${index}`, endpoint));
  let saved: ModelPickerPreferencesSnapshot = {
    provider_preferences: [],
    model_preferences: models.map(model => ({ model_config_id: model.id, visible: false })),
  };
  const preferences = new ModelPickerPreferencesRegistry({
    load: async () => structuredClone(saved),
    save: async snapshot => {
      saved = structuredClone(snapshot);
    },
  });
  await preferences.initialize({
    configured_provider_ids: [],
    model_config_ids: models.map(model => model.id),
  });
  let revision = 0;
  const registerUserModels = vi.fn(
    async (registrations: readonly UserModelRegistration[], expectedRevision: number) => {
      if (expectedRevision !== revision) throw new ModelCatalogConflictError();
      for (const { model, endpoint: selection } of registrations) {
        if (selection.kind !== 'existing') throw new Error('刷新必须复用当前连接');
        models.push({ ...model, inference_endpoint_id: selection.inference_endpoint_id });
      }
      revision += 1;
    }
  );
  const resolveCredential = vi.fn((modelId: string) => `stored-key:${modelId}`);
  let nextId = 0;
  const useCase = createCustomApiOnboardingUseCase({
    modelCatalog: {
      getUserRevision: () => revision,
      applyDiff: vi.fn(),
      getModels: () => models,
      getInferenceEndpoints: () => endpoints,
      resolveCredential,
      registerUserModels,
      rebindUserModels: vi.fn(),
    },
    providerMembership: { getByModelConfigId: () => undefined },
    modelPickerPreferences: preferences,
    modelDiscovery: new ModelDiscoveryService({ fetchFn }),
    idFactory: { create: () => `new-${++nextId}` },
  });
  return {
    useCase,
    models,
    preferences,
    registerUserModels,
    resolveCredential,
    changeConfiguration: () => {
      revision += 1;
    },
  };
}

function listing(ids: readonly string[]): Response {
  return Response.json({
    data: ids.map(id => ({
      id,
      context_window: 128_000,
      max_output_tokens: 16_384,
    })),
  });
}

describe('自定义模型分组刷新', () => {
  it('用已保存 Key 查询，按远端 ID 去重，连续刷新保留已有模型与关闭偏好', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const target = await setup(async (url, init) => {
      const authorization = new Headers(init?.headers).get('authorization');
      requests.push({ url: String(url), authorization });
      if (authorization !== 'Bearer stored-key:local-0') return new Response('', { status: 401 });
      return listing(['remote-local-0', 'remote-local-1', 'remote-new', 'remote-new']);
    });
    target.models.push(configuredModel('local-1'));
    await target.preferences.setModelVisibility('local-0', true);
    await target.preferences.setModelVisibility('local-1', false);
    const original = structuredClone(target.models);

    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).resolves.toEqual({
      provider_name: 'Relay',
      added_model_ids: ['new-1'],
    });
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).resolves.toEqual({
      provider_name: 'Relay',
      added_model_ids: [],
    });

    expect(requests).toEqual(
      Array.from({ length: 2 }, () => ({
        url: 'https://relay.example.com/v1/models',
        authorization: 'Bearer stored-key:local-0',
      }))
    );
    expect(target.registerUserModels).toHaveBeenCalledOnce();
    expect(target.registerUserModels.mock.calls[0]?.[0][0].endpoint).toEqual({
      kind: 'existing',
      inference_endpoint_id: 'relay-endpoint',
    });
    expect(target.models.slice(0, 2)).toEqual(original);
    expect(target.models[2]?.inference_route?.endpoint_model_id).toBe('remote-new');
    expect(target.preferences.read().model_preferences).toEqual([
      { model_config_id: 'local-0', visible: true },
      { model_config_id: 'local-1', visible: false },
      { model_config_id: 'new-1', visible: false },
    ]);
  });

  it('同名分组中的多个连接各自使用自己的地址、协议和 Key', async () => {
    const other: InferenceEndpointView = {
      ...connection,
      id: 'other',
      endpoint_id: 'custom-anthropic-compatible:other',
      base_url: 'https://other.example.com/v1',
      route_profile_id: 'anthropic_messages',
      auth_profile: 'api_key',
      credential_reference: { kind: 'stored_secret', credential_id: 'other-key' },
    };
    const requests: { url: string; bearer: string | null; apiKey: string | null }[] = [];
    const target = await setup(
      async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          bearer: headers.get('authorization'),
          apiKey: headers.get('x-api-key'),
        });
        return listing(['new-on-both-endpoints']);
      },
      [connection, other]
    );

    await target.useCase.refreshProvider({ provider_name: 'Relay' });
    expect(requests).toEqual([
      {
        url: 'https://relay.example.com/v1/models',
        bearer: 'Bearer stored-key:local-0',
        apiKey: null,
      },
      {
        url: 'https://other.example.com/v1/models?limit=1000',
        bearer: null,
        apiKey: 'stored-key:local-1',
      },
    ]);
    expect(target.models.slice(2).map(model => model.inference_endpoint_id)).toEqual([
      'relay-endpoint',
      'other',
    ]);
  });

  it.each([401, 503])('查询返回 %i 时不写目录或偏好，也不回显远端正文', async status => {
    const target = await setup(async () => new Response('stored-key:local-0', { status }));
    const before = target.preferences.read();
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).rejects.toMatchObject({
      code: 'custom_api_onboarding.refresh_failed',
      statusCode: status,
      message: expect.not.stringContaining('stored-key:'),
    });
    expect(target.registerUserModels).not.toHaveBeenCalled();
    expect(target.preferences.read()).toEqual(before);
  });

  it('后一个连接失败时，不部分写入前一个连接的新模型', async () => {
    const target = await setup(
      async url =>
        String(url).includes('other.example.com')
          ? new Response('', { status: 403 })
          : listing(['remote-new']),
      [connection, { ...connection, id: 'other', base_url: 'https://other.example.com/v1' }]
    );
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).rejects.toMatchObject({
      code: 'custom_api_onboarding.refresh_failed',
    });
    expect(target.registerUserModels).not.toHaveBeenCalled();
    expect(target.preferences.read().model_preferences).toHaveLength(2);
  });

  it('缺少已保存凭据时不发送匿名请求', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const target = await setup(fetchFn);
    target.resolveCredential.mockReturnValue('');
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).rejects.toMatchObject({
      code: 'custom_api_onboarding.credential_required',
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(target.registerUserModels).not.toHaveBeenCalled();
  });

  it('远端暂时返回空列表时，不删除本地模型或改变偏好', async () => {
    const target = await setup(async () => listing([]));
    const original = structuredClone(target.models);
    const preferences = target.preferences.read();
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).resolves.toEqual({
      provider_name: 'Relay',
      added_model_ids: [],
    });
    expect(target.models).toEqual(original);
    expect(target.preferences.read()).toEqual(preferences);
  });
  it('发现期间连接编辑或删除后，拒绝旧响应写回', async () => {
    let complete!: (response: Response) => void;
    const target = await setup(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    const pending = target.useCase.refreshProvider({ provider_name: 'Relay' });
    target.changeConfiguration();
    complete(listing(['remote-new']));
    await expect(pending).rejects.toMatchObject({
      code: 'custom_api_onboarding.configuration_changed',
      statusCode: 409,
    });
    expect(target.models).toHaveLength(1);
  });

  it('同一版本并发刷新只提交一次，另一请求返回配置冲突而非重复添加', async () => {
    const target = await setup(async () => listing(['remote-new']));
    const results = await Promise.allSettled([
      target.useCase.refreshProvider({ provider_name: 'Relay' }),
      target.useCase.refreshProvider({ provider_name: 'Relay' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(target.models).toHaveLength(2);
  });
  it('多连接发现开始前固定凭据，编辑期间的新 Key 不会发往旧地址', async () => {
    const other: InferenceEndpointView = {
      ...connection,
      id: 'other',
      endpoint_id: 'custom-openai-compatible:other',
      base_url: 'https://old-other.example/v1',
      credential_reference: { kind: 'stored_secret', credential_id: 'other-key' },
    };
    const requests: { url: string; authorization: string | null }[] = [];
    const target = await setup(
      async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        if (requests.length === 1) {
          target.resolveCredential.mockReturnValue('new-host-secret');
          target.changeConfiguration();
        }
        return listing(['remote-new']);
      },
      [connection, other]
    );
    await expect(target.useCase.refreshProvider({ provider_name: 'Relay' })).rejects.toMatchObject({
      code: 'custom_api_onboarding.configuration_changed',
    });
    expect(requests[1]).toEqual({
      url: 'https://old-other.example/v1/models',
      authorization: 'Bearer stored-key:local-1',
    });
    expect(JSON.stringify(requests)).not.toContain('new-host-secret');
    expect(target.models).toHaveLength(2);
  });
});
