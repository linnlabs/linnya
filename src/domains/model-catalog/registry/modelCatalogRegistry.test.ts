import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { ModelConfig } from '../definitions/modelCatalog';

const { credentialStoreMock, fetchCloudModelsMock, persisterMock } = vi.hoisted(() => {
  return {
    fetchCloudModelsMock: vi.fn(),
    persisterMock: {
      initialize: vi.fn(async () => {}),
      loadState: vi.fn<
        () => Promise<{
          readonly inferenceEndpoints: readonly unknown[];
          readonly models: readonly unknown[];
        }>
      >(async () => ({ inferenceEndpoints: [], models: [] })),
      saveState: vi.fn(async () => {}),
    },
    credentialStoreMock: {
      initialize: vi.fn(async () => {}),
      installCodec: vi.fn(),
      has: vi.fn(() => true),
      resolve: vi.fn(() => 'stored-secret'),
      put: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  };
});

vi.mock('../features/cloud-catalog/orchestration/fetchCloudModels', () => ({
  fetchCloudModels: fetchCloudModelsMock,
}));

vi.mock('../features/user-model-persistence/orchestration/modelPersister', () => ({
  modelPersister: persisterMock,
}));

vi.mock('../features/inference-endpoints/orchestration/endpointCredentialStore', () => ({
  endpointCredentialStore: credentialStoreMock,
}));

function buildCloudModel(id: string): ModelConfig {
  return {
    id,
    model_name: id,
    catalog_source: 'cloud',
    credential_reference: { kind: 'host_managed', credential_id: 'linnya-cloud' },
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: id,
    description: 'test cloud model',
    billing_mode: 'cloud',
    enable_client_retry: false,
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'deepseek',
      endpoint_model_id: id,
      base_url: 'https://api.linnyai.com/proxy/deepseek',
      auth_profile: 'bearer',
      context_window_tokens: 64_000,
      max_output_tokens: 8_192,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    },
  };
}

function buildUserEndpoint(id: string) {
  return {
    id,
    route_profile_id: 'openai_chat',
    endpoint_id: 'deepseek',
    base_url: 'https://api.linnyai.com/proxy/deepseek',
    auth_profile: 'bearer',
    credential_reference: { kind: 'stored_secret', credential_id: `inference-endpoint:${id}` },
  };
}

function buildUserModel(id: string, endpointId: string): ModelConfig {
  return {
    ...buildCloudModel(id),
    catalog_source: 'user',
    billing_mode: 'byok',
    credential_reference: undefined,
    inference_endpoint_id: endpointId,
  };
}

function buildAccountImageModel(id: string, accountId: string): ModelConfig {
  return {
    id,
    model_name: 'gpt-image-2',
    catalog_source: 'account',
    credential_reference: { kind: 'provider_account', account_id: accountId },
    capabilities: ['image_generation'],
    ui_visibility: ['image_generation'],
    display_name: 'GPT Image 2',
    description: 'ChatGPT subscription image generation',
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
    image_generation: {
      allowed_sizes: ['1024x1024', '1536x1024', '1024x1536'],
    },
  };
}

describe('Registry cloud retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fetchCloudModelsMock.mockReset();
    persisterMock.initialize.mockClear();
    persisterMock.loadState.mockReset();
    persisterMock.loadState.mockResolvedValue({ inferenceEndpoints: [], models: [] });
    persisterMock.saveState.mockReset();
    persisterMock.saveState.mockResolvedValue(undefined);
    credentialStoreMock.initialize.mockClear();
    credentialStoreMock.has.mockReturnValue(true);
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    process.env.MODEL_REGISTRY_DEFAULTS_PATH = path.resolve(
      process.cwd(),
      'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('retries cloud model loading in background after startup failure', async () => {
    fetchCloudModelsMock
      .mockResolvedValueOnce({
        success: false,
        models: [],
        failureReason: 'network_error',
      })
      .mockResolvedValueOnce({
        success: true,
        models: [buildCloudModel('cloud-test-model')],
        purposeDefaults: {
          autocomplete: 'cloud-test-model',
        },
      });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await registry.initialize();

    expect(fetchCloudModelsMock).toHaveBeenCalledTimes(1);
    expect(registry.getModel('cloud-test-model')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchCloudModelsMock).toHaveBeenCalledTimes(2);
    expect(registry.getModel('cloud-test-model')).toMatchObject({
      id: 'cloud-test-model',
      billing_mode: 'cloud',
    });
    expect(registry.getFunctionalDefaultModelId('autocomplete')).toBe('cloud-test-model');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchCloudModelsMock).toHaveBeenCalledTimes(2);
  });
});

describe('Registry default model by capability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fetchCloudModelsMock.mockReset();
    persisterMock.initialize.mockClear();
    persisterMock.loadState.mockReset();
    persisterMock.loadState.mockResolvedValue({ inferenceEndpoints: [], models: [] });
    persisterMock.saveState.mockReset();
    persisterMock.saveState.mockResolvedValue(undefined);
    credentialStoreMock.initialize.mockClear();
    credentialStoreMock.has.mockReturnValue(true);
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    process.env.MODEL_REGISTRY_DEFAULTS_PATH = path.resolve(
      process.cwd(),
      'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('返回第一个 capability 匹配模型 ID', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({
      inferenceEndpoints: [buildUserEndpoint('endpoint-1')],
      models: [
        {
          ...buildUserModel('first-ocr', 'endpoint-1'),
          capabilities: ['chat', 'unit_test_default'],
        },
        {
          ...buildUserModel('second-ocr', 'endpoint-1'),
          capabilities: ['chat', 'unit_test_default'],
        },
      ],
    });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    expect(registry.getDefaultModelIdByCapability('unit_test_default')).toBe('first-ocr');
  });

  it('无 capability 匹配时返回 undefined', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({ inferenceEndpoints: [], models: [] });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    expect(registry.getDefaultModelIdByCapability('missing_capability')).toBeUndefined();
  });

  it('账号模型只进入进程目录，登出删除且非法替换不破坏已有投影', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();
    persisterMock.saveState.mockClear();

    const accountId = 'chatgpt-subscription';
    const model = buildAccountImageModel('chatgpt-image-model', accountId);
    registry.replaceAccountModels(accountId, [model]);

    expect(registry.getModel(model.id)).toMatchObject({
      catalog_source: 'account',
      capabilities: ['image_generation'],
    });
    expect(registry.getCredentialReference(model.id)).toEqual({
      kind: 'provider_account',
      account_id: accountId,
    });
    expect(persisterMock.saveState).not.toHaveBeenCalled();

    expect(() =>
      registry.replaceAccountModels(accountId, [
        buildAccountImageModel(model.id, 'another-account'),
      ])
    ).toThrow('credential reference 不匹配');
    expect(registry.getModel(model.id)).toBeDefined();

    registry.removeAccountModels(accountId);
    expect(registry.getModel(model.id)).toBeUndefined();
    expect(persisterMock.saveState).not.toHaveBeenCalled();
  });

  it('保存云端功能默认模型表，并忽略当前不可用的默认模型', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [buildCloudModel('cloud-fast-model')],
      purposeDefaults: {
        autocomplete: 'cloud-fast-model',
        knowledge_graph_extraction: 'cloud-missing-model',
      },
    });
    persisterMock.loadState.mockResolvedValueOnce({ inferenceEndpoints: [], models: [] });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    expect(registry.getFunctionalModelDefaults()).toEqual({
      autocomplete: 'cloud-fast-model',
      knowledge_graph_extraction: 'cloud-missing-model',
    });
    expect(registry.getFunctionalDefaultModelId('autocomplete')).toBe('cloud-fast-model');
    expect(registry.getFunctionalDefaultModelId('knowledge_graph_extraction')).toBeUndefined();
  });

  it('同一 InferenceEndpoint 可跨模型复用，持久化快照不包含明文凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    await registry.registerUserModel(buildUserModel('first-user-model', 'shared-endpoint'), {
      kind: 'create',
      endpoint: {
        id: 'shared-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        credential_secret: 'secret-value',
      },
    });
    await registry.registerUserModel(buildUserModel('second-user-model', 'shared-endpoint'), {
      kind: 'existing',
      inference_endpoint_id: 'shared-endpoint',
    });

    expect(credentialStoreMock.put).toHaveBeenCalledTimes(1);
    expect(registry.resolveCredential('second-user-model')).toBe('stored-secret');
    expect(registry.getInferenceRouteProfileId('second-user-model')).toBe('openai_chat');
    expect(registry.getInferenceEndpoints()).toEqual([
      expect.objectContaining({ id: 'shared-endpoint', credential_status: 'configured' }),
    ]);
    expect(JSON.stringify(persisterMock.saveState.mock.calls)).not.toContain('secret-value');
  });

  it('正式 Provider 新模型可在同一 endpoint 内替换凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({
      inferenceEndpoints: [buildUserEndpoint('shared-endpoint')],
      models: [buildUserModel('first-user-model', 'shared-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();
    credentialStoreMock.put.mockClear();

    await registry.registerUserModel(buildUserModel('second-user-model', 'shared-endpoint'), {
      kind: 'existing',
      inference_endpoint_id: 'shared-endpoint',
      credential_secret: 'replacement-secret',
    });

    expect(credentialStoreMock.put).toHaveBeenCalledOnce();
    expect(credentialStoreMock.put).toHaveBeenCalledWith(
      'inference-endpoint:shared-endpoint',
      'replacement-secret'
    );
    expect(registry.getInferenceEndpoints()).toHaveLength(1);
    expect(JSON.stringify(persisterMock.saveState.mock.calls)).not.toContain('replacement-secret');
  });

  it('同一正式 Provider 的多协议 endpoint 共享一份凭据，并在最后一条 route 删除后清理', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();
    const credentialReference = {
      kind: 'stored_secret' as const,
      credential_id: 'configured-provider:opencode-go',
    };

    await registry.registerUserModel(buildUserModel('go-chat-model', 'go-chat-endpoint'), {
      kind: 'create',
      endpoint: {
        id: 'go-chat-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        credential_reference: credentialReference,
        credential_secret: 'go-secret',
      },
    });
    await registry.registerUserModel(
      buildUserModel('go-second-chat-model', 'go-second-chat-endpoint'),
      {
        kind: 'create',
        endpoint: {
          id: 'go-second-chat-endpoint',
          route_profile_id: 'openai_chat',
          endpoint_id: 'deepseek',
          base_url: 'https://api.linnyai.com/proxy/deepseek',
          auth_profile: 'bearer',
          credential_reference: credentialReference,
        },
      }
    );

    expect(credentialStoreMock.put).toHaveBeenCalledTimes(1);
    expect(registry.getInferenceEndpoints()).toHaveLength(2);

    credentialStoreMock.remove.mockClear();
    await registry.removeModel('go-chat-model');
    expect(credentialStoreMock.remove).not.toHaveBeenCalled();
    expect(registry.getInferenceEndpoints().map(endpoint => endpoint.id)).toEqual([
      'go-second-chat-endpoint',
    ]);

    await registry.removeModel('go-second-chat-model');
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('configured-provider:opencode-go');
  });

  it('替换凭据后目录写入失败时恢复旧 secret 且不注册模型', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({
      inferenceEndpoints: [buildUserEndpoint('shared-endpoint')],
      models: [buildUserModel('first-user-model', 'shared-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();
    credentialStoreMock.put.mockClear();
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(
      registry.registerUserModel(buildUserModel('second-user-model', 'shared-endpoint'), {
        kind: 'existing',
        inference_endpoint_id: 'shared-endpoint',
        credential_secret: 'replacement-secret',
      })
    ).rejects.toThrow('disk unavailable');

    expect(credentialStoreMock.put.mock.calls).toEqual([
      ['inference-endpoint:shared-endpoint', 'replacement-secret'],
      ['inference-endpoint:shared-endpoint', 'stored-secret'],
    ]);
    expect(registry.getModel('second-user-model')).toBeUndefined();
  });

  it('删除最后一个引用模型时原子清理 endpoint 与凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    await registry.registerUserModel(buildUserModel('first-user-model', 'shared-endpoint'), {
      kind: 'create',
      endpoint: {
        id: 'shared-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        credential_secret: 'secret-value',
      },
    });
    await registry.registerUserModel(buildUserModel('second-user-model', 'shared-endpoint'), {
      kind: 'existing',
      inference_endpoint_id: 'shared-endpoint',
    });

    credentialStoreMock.remove.mockClear();
    await registry.removeModel('first-user-model');
    expect(registry.getInferenceEndpoints()).toHaveLength(1);
    expect(credentialStoreMock.remove).not.toHaveBeenCalled();

    await registry.removeModel('second-user-model');
    expect(registry.getInferenceEndpoints()).toEqual([]);
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('inference-endpoint:shared-endpoint');
    expect(persisterMock.saveState).toHaveBeenLastCalledWith([], []);
  });

  it('删除最后引用的目录写入失败时恢复 endpoint 与凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();

    await registry.registerUserModel(buildUserModel('only-user-model', 'only-endpoint'), {
      kind: 'create',
      endpoint: {
        id: 'only-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        credential_secret: 'secret-value',
      },
    });

    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(registry.removeModel('only-user-model')).rejects.toThrow('disk unavailable');
    expect(registry.getModel('only-user-model')).toBeDefined();
    expect(registry.getInferenceEndpoints()).toEqual([
      expect.objectContaining({ id: 'only-endpoint', credential_status: 'configured' }),
    ]);
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('inference-endpoint:only-endpoint');
    expect(credentialStoreMock.put).toHaveBeenCalledWith(
      'inference-endpoint:only-endpoint',
      'stored-secret'
    );
  });

  it('用户目录写入失败时不提交内存变更', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({ inferenceEndpoints: [], models: [] });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize();
    credentialStoreMock.has.mockReturnValue(false);
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));

    const model = buildUserModel('user-atomic-model', 'new-endpoint');
    await expect(
      registry.registerUserModel(model, {
        kind: 'create',
        endpoint: {
          id: 'new-endpoint',
          route_profile_id: 'openai_chat',
          endpoint_id: 'deepseek',
          base_url: 'https://api.linnyai.com/proxy/deepseek',
          auth_profile: 'bearer',
          credential_secret: 'secret-value',
        },
      })
    ).rejects.toThrow('disk unavailable');
    expect(registry.getModel(model.id)).toBeUndefined();
    expect(credentialStoreMock.put).toHaveBeenCalledWith(
      'inference-endpoint:new-endpoint',
      'secret-value'
    );
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('inference-endpoint:new-endpoint');
  });
});
