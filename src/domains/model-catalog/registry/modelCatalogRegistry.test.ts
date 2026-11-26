import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { ModelConfig } from '../definitions/modelCatalog';
import {
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../shared/distribution-identity';

// 这里验证 Cloud 服务开放后的接入逻辑；服务当前是否开放由 isLinnyaCloudClientEnabled 自己的测试负责。
vi.mock('../features/cloud-catalog/functions/isLinnyaCloudClientEnabled', () => ({
  isLinnyaCloudClientEnabled: (identity: { readonly kind: string }) => identity.kind === 'official',
}));

const { credentialStoreMock, credentialRollbackMock, fetchCloudModelsMock, persisterMock } =
  vi.hoisted(() => {
    const credentialRollbackMock = vi.fn(async (_credentialId: string) => {});
    return {
      credentialRollbackMock,
      fetchCloudModelsMock: vi.fn(),
      persisterMock: {
        initialize: vi.fn(async () => {}),
        loadState: vi.fn<
          () => Promise<{
            readonly customApiGroups: readonly import('../definitions/customApiGroup').CustomApiGroup[];
            readonly requiresMigration: boolean;
            readonly inferenceEndpoints: readonly unknown[];
            readonly models: readonly unknown[];
          }>
        >(async () => ({
          customApiGroups: [],
          requiresMigration: false,
          inferenceEndpoints: [],
          models: [],
        })),
        saveState: vi.fn(async () => {}),
      },
      credentialStoreMock: {
        initialize: vi.fn(async () => {}),
        installStorage: vi.fn(),
        captureRollback: vi.fn(
          (credentialId: string) => () => credentialRollbackMock(credentialId)
        ),
        has: vi.fn((_credentialId: string) => true),
        getStatus: vi.fn(() => 'available'),
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
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [],
      models: [],
    });
    persisterMock.saveState.mockReset();
    persisterMock.saveState.mockResolvedValue(undefined);
    credentialStoreMock.initialize.mockClear();
    credentialStoreMock.has.mockReturnValue(true);
    credentialStoreMock.getStatus.mockReturnValue('available');
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    credentialRollbackMock.mockClear();
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

    await registry.initialize(
      createOfficialDistributionIdentity({
        releaseChannel: 'stable',
        releaseKeyId: 'fixture',
      })
    );

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

  it('源码发行身份不请求 Cloud，也不安排后台重试', async () => {
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await registry.initialize(createSourceDistributionIdentity());

    expect(fetchCloudModelsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchCloudModelsMock).not.toHaveBeenCalled();
  });
});

describe('Registry default model by capability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fetchCloudModelsMock.mockReset();
    persisterMock.initialize.mockClear();
    persisterMock.loadState.mockReset();
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [],
      models: [],
    });
    persisterMock.saveState.mockReset();
    persisterMock.saveState.mockResolvedValue(undefined);
    credentialStoreMock.initialize.mockClear();
    credentialStoreMock.has.mockReturnValue(true);
    credentialStoreMock.getStatus.mockReturnValue('available');
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    credentialRollbackMock.mockClear();
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
      customApiGroups: [],
      requiresMigration: false,
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
    await registry.initialize(createSourceDistributionIdentity());

    expect(registry.getDefaultModelIdByCapability('unit_test_default')).toBe('first-ocr');
  });

  it('无 capability 匹配时返回 undefined', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [],
      models: [],
    });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());

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
    await registry.initialize(createSourceDistributionIdentity());
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
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [],
      models: [],
    });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(
      createOfficialDistributionIdentity({
        releaseChannel: 'stable',
        releaseKeyId: 'fixture',
      })
    );

    expect(registry.getFunctionalModelDefaults()).toEqual({
      autocomplete: 'cloud-fast-model',
      knowledge_graph_extraction: 'cloud-missing-model',
    });
    expect(registry.getFunctionalDefaultModelId('autocomplete')).toBe('cloud-fast-model');
    expect(registry.getFunctionalDefaultModelId('knowledge_graph_extraction')).toBeUndefined();
  });

  it('初始化没有成功时拒绝写入用户配置：不准备凭据，也不覆写原文件', async () => {
    persisterMock.loadState.mockRejectedValueOnce(
      new Error('user_models.json 无法读取：Unexpected end of JSON input')
    );
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await expect(registry.initialize(createSourceDistributionIdentity())).rejects.toThrow(
      'user_models.json 无法读取'
    );

    await expect(
      registry.registerUserModel(buildUserModel('first-user-model', 'shared-endpoint'), {
        kind: 'create',
        endpoint: {
          id: 'shared-endpoint',
          route_profile_id: 'openai_chat',
          endpoint_id: 'deepseek',
          base_url: 'https://api.linnyai.com/proxy/deepseek',
          auth_profile: 'bearer',
          credential_secret: 'secret-value',
        },
      })
    ).rejects.toThrow('模型目录在启动时没有初始化成功');
    expect(credentialStoreMock.put).not.toHaveBeenCalled();
    expect(persisterMock.saveState).not.toHaveBeenCalled();
  });

  it('同一 InferenceEndpoint 可跨模型复用，持久化快照不包含明文凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());

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
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('shared-endpoint')],
      models: [buildUserModel('first-user-model', 'shared-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
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
    await registry.initialize(createSourceDistributionIdentity());
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
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('shared-endpoint')],
      models: [buildUserModel('first-user-model', 'shared-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
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
    ]);
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:shared-endpoint');
    expect(registry.getModel('second-user-model')).toBeUndefined();
  });

  it('用户目录事务提交后才通知变更：读方能读到新模型，写盘失败不通知，监听异常不影响提交', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    const seen: Array<{ revision: number; visible: boolean }> = [];
    const unsubscribe = registry.onUserModelCatalogChanged(event => {
      seen.push({ revision: event.revision, visible: registry.getModel('notified-model') !== undefined });
    });
    registry.onUserModelCatalogChanged(() => {
      throw new Error('listener failure');
    });
    const startRevision = registry.getUserRevision();

    await registry.registerUserModel(buildUserModel('notified-model', 'notified-endpoint'), {
      kind: 'create',
      endpoint: {
        id: 'notified-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        credential_secret: 'secret-value',
      },
    });
    expect(seen).toEqual([{ revision: startRevision + 1, visible: true }]);

    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(
      registry.registerUserModel(buildUserModel('failed-model', 'notified-endpoint'), {
        kind: 'existing',
        inference_endpoint_id: 'notified-endpoint',
      })
    ).rejects.toThrow('disk unavailable');
    expect(seen).toHaveLength(1);

    unsubscribe();
    await registry.removeModel('notified-model');
    expect(seen).toHaveLength(1);
    expect(registry.getUserRevision()).toBe(startRevision + 2);
  });

  it('删除最后一个引用模型时原子清理 endpoint 与凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());

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
    expect(persisterMock.saveState).toHaveBeenLastCalledWith([], [], [], []);
  });

  it('删除最后引用的目录写入失败时恢复 endpoint 与凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());

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
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:only-endpoint');
  });

  it('改绑一组用户模型到新 endpoint 时清理旧 endpoint 与独占凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({ success: true, models: [], purposeDefaults: {} });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('old-endpoint')],
      models: [
        buildUserModel('first-user-model', 'old-endpoint'),
        buildUserModel('second-user-model', 'old-endpoint'),
      ],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.has.mockImplementation(
      (credentialId: string) => credentialId !== 'inference-endpoint:new-endpoint'
    );
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();

    const nextBaseUrl = 'https://gateway.example.com/v1';
    const rebound = ['first-user-model', 'second-user-model'].map(id => {
      const model = buildUserModel(id, 'new-endpoint');
      return {
        ...model,
        inference_route: { ...model.inference_route!, base_url: nextBaseUrl },
      };
    });
    await registry.rebindUserModels(rebound, {
      kind: 'create',
      endpoint: {
        id: 'new-endpoint',
        route_profile_id: 'openai_chat',
        endpoint_id: 'deepseek',
        base_url: nextBaseUrl,
        auth_profile: 'bearer',
        credential_secret: 'rotated-secret',
      },
    });

    expect(credentialStoreMock.put).toHaveBeenCalledWith(
      'inference-endpoint:new-endpoint',
      'rotated-secret'
    );
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('inference-endpoint:old-endpoint');
    expect(registry.getInferenceEndpoints().map(endpoint => endpoint.id)).toEqual(['new-endpoint']);
    expect(registry.getModel('first-user-model')).toMatchObject({
      inference_endpoint_id: 'new-endpoint',
      inference_route: { base_url: nextBaseUrl },
    });
    expect(JSON.stringify(persisterMock.saveState.mock.calls)).not.toContain('rotated-secret');
  });

  it('改绑时复用仍被新 endpoint 引用的凭据，不删除凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({ success: true, models: [], purposeDefaults: {} });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('old-endpoint')],
      models: [buildUserModel('only-user-model', 'old-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();

    const nextBaseUrl = 'https://gateway.example.com/v1';
    const model = buildUserModel('only-user-model', 'new-endpoint');
    await registry.rebindUserModels(
      [{ ...model, inference_route: { ...model.inference_route!, base_url: nextBaseUrl } }],
      {
        kind: 'create',
        endpoint: {
          id: 'new-endpoint',
          route_profile_id: 'openai_chat',
          endpoint_id: 'deepseek',
          base_url: nextBaseUrl,
          auth_profile: 'bearer',
          credential_reference: {
            kind: 'stored_secret',
            credential_id: 'inference-endpoint:old-endpoint',
          },
        },
      }
    );

    expect(credentialStoreMock.put).not.toHaveBeenCalled();
    expect(credentialStoreMock.remove).not.toHaveBeenCalled();
    expect(registry.getInferenceEndpoints()).toEqual([
      expect.objectContaining({
        id: 'new-endpoint',
        credential_reference: {
          kind: 'stored_secret',
          credential_id: 'inference-endpoint:old-endpoint',
        },
      }),
    ]);
  });

  it('改绑写盘失败时保留旧目录并撤销新旧凭据变更', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({ success: true, models: [], purposeDefaults: {} });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('old-endpoint')],
      models: [buildUserModel('only-user-model', 'old-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.has.mockImplementation(
      (credentialId: string) => credentialId !== 'inference-endpoint:new-endpoint'
    );
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));

    const nextBaseUrl = 'https://gateway.example.com/v1';
    const model = buildUserModel('only-user-model', 'new-endpoint');
    await expect(
      registry.rebindUserModels(
        [{ ...model, inference_route: { ...model.inference_route!, base_url: nextBaseUrl } }],
        {
          kind: 'create',
          endpoint: {
            id: 'new-endpoint',
            route_profile_id: 'openai_chat',
            endpoint_id: 'deepseek',
            base_url: nextBaseUrl,
            auth_profile: 'bearer',
            credential_secret: 'rotated-secret',
          },
        }
      )
    ).rejects.toThrow('disk unavailable');

    expect(registry.getModel('only-user-model')).toMatchObject({
      inference_endpoint_id: 'old-endpoint',
    });
    expect(registry.getInferenceEndpoints().map(endpoint => endpoint.id)).toEqual(['old-endpoint']);
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:new-endpoint');
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:old-endpoint');
  });

  it('改绑只接受已存在的用户模型，失败时不写凭据', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({ success: true, models: [], purposeDefaults: {} });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('old-endpoint')],
      models: [buildUserModel('only-user-model', 'old-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.put.mockClear();

    await expect(
      registry.rebindUserModels([buildUserModel('missing-model', 'old-endpoint')], {
        kind: 'existing',
        inference_endpoint_id: 'old-endpoint',
        credential_secret: 'rotated-secret',
      })
    ).rejects.toThrow('用户模型不存在: missing-model');
    await expect(
      registry.rebindUserModels([], { kind: 'existing', inference_endpoint_id: 'old-endpoint' })
    ).rejects.toThrow('至少需要一个用户模型');
    expect(credentialStoreMock.put).not.toHaveBeenCalled();
  });

  it('在原 credential boundary 内替换 endpoint 凭据且不改写目录文件', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({ success: true, models: [], purposeDefaults: {} });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('only-endpoint')],
      models: [buildUserModel('only-user-model', 'only-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.put.mockClear();
    persisterMock.saveState.mockClear();

    await registry.replaceInferenceEndpointCredential('only-endpoint', '  rotated-secret  ');

    expect(credentialStoreMock.put).toHaveBeenCalledWith(
      'inference-endpoint:only-endpoint',
      'rotated-secret'
    );
    expect(persisterMock.saveState).not.toHaveBeenCalled();
    await expect(
      registry.replaceInferenceEndpointCredential('only-endpoint', '  ')
    ).rejects.toThrow('credential secret 不能为空');
    await expect(
      registry.replaceInferenceEndpointCredential('missing-endpoint', 'rotated-secret')
    ).rejects.toThrow('InferenceEndpoint 不存在');
  });

  it('并发用户修改串行提交，写盘期间的账号投影不会被旧快照覆盖', async () => {
    const first = buildUserModel('first', 'shared');
    const second = buildUserModel('second', 'shared');
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      models: [first, second],
      inferenceEndpoints: [buildUserEndpoint('shared')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    let complete!: () => void;
    persisterMock.saveState.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        })
    );
    const firstWrite = registry.updateModel({ ...first, display_name: 'first updated' });
    await vi.waitFor(() => expect(persisterMock.saveState).toHaveBeenCalledOnce());
    const secondWrite = registry.updateModel({ ...second, display_name: 'second updated' });
    await Promise.resolve();
    expect(persisterMock.saveState).toHaveBeenCalledOnce();
    registry.replaceAccountModels('account', [buildAccountImageModel('image', 'account')]);
    complete();
    await Promise.all([firstWrite, secondWrite]);
    expect(registry.getModel('first')?.display_name).toBe('first updated');
    expect(registry.getModel('second')?.display_name).toBe('second updated');
    expect(registry.getModel('image')?.catalog_source).toBe('account');
  });

  it('前一事务失败不吞掉后一事务，也不覆盖退出登录删除的投影', async () => {
    const model = buildUserModel('user', 'endpoint');
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      models: [model],
      inferenceEndpoints: [buildUserEndpoint('endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    registry.replaceAccountModels('account', [buildAccountImageModel('image', 'account')]);
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk unavailable'));
    const failed = registry.updateModel({ ...model, display_name: 'failed' });
    let complete!: () => void;
    persisterMock.saveState.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        })
    );
    const successful = registry.updateModel({ ...model, display_name: 'saved' });
    await expect(failed).rejects.toThrow('disk unavailable');
    await vi.waitFor(() => expect(persisterMock.saveState).toHaveBeenCalledTimes(2));
    registry.removeAccountModels('account');
    complete();
    await successful;
    expect(registry.getModel('user')?.display_name).toBe('saved');
    expect(registry.getModel('image')).toBeUndefined();
  });

  it('用户目录写入失败时不提交内存变更', async () => {
    fetchCloudModelsMock.mockResolvedValueOnce({
      success: true,
      models: [],
      purposeDefaults: {},
    });
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [],
      models: [],
    });

    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
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
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:new-endpoint');
  });
  it('整批注册只发布一次目录；删除或编辑后的旧版本不能继续注册', async () => {
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('shared')],
      models: [buildUserModel('existing', 'shared')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    const revision = registry.getUserRevision();
    const registrations = ['a', 'b'].map(id => ({
      model: buildUserModel(id, 'shared'),
      endpoint: { kind: 'existing' as const, inference_endpoint_id: 'shared' },
    }));
    await registry.registerUserModels(registrations, revision);
    expect(persisterMock.saveState).toHaveBeenCalledOnce();
    expect(registry.getModel('a')).toBeDefined();
    expect(registry.getModel('b')).toBeDefined();
    await expect(
      registry.registerUserModels(
        [{ ...registrations[0], model: buildUserModel('stale', 'shared') }],
        revision
      )
    ).rejects.toMatchObject({ name: 'ModelCatalogConflictError' });
    expect(registry.getModel('stale')).toBeUndefined();
    const beforeDeletion = registry.getUserRevision();
    await registry.applyDiff(
      { added: [], updated: [], removed: ['a', 'b', 'existing'] },
      beforeDeletion
    );
    await expect(registry.registerUserModels(registrations, beforeDeletion)).rejects.toMatchObject({
      name: 'ModelCatalogConflictError',
    });
    expect(registry.getInferenceEndpoints()).toEqual([]);
  });

  it('后一个注册失败时撤销前面的凭据准备，不发布半批模型', async () => {
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.has.mockReturnValue(false);
    await expect(
      registry.registerUserModels(
        [
          {
            model: buildUserModel('first', 'new'),
            endpoint: {
              kind: 'create',
              endpoint: {
                id: 'new',
                route_profile_id: 'openai_chat',
                endpoint_id: 'deepseek',
                base_url: 'https://api.linnyai.com/proxy/deepseek',
                auth_profile: 'bearer',
                credential_secret: 'secret',
              },
            },
          },
          {
            model: buildUserModel('second', 'missing'),
            endpoint: { kind: 'existing', inference_endpoint_id: 'missing' },
          },
        ],
        registry.getUserRevision()
      )
    ).rejects.toThrow('InferenceEndpoint 不存在');
    expect(registry.getModel('first')).toBeUndefined();
    expect(registry.getModel('second')).toBeUndefined();
    expect(persisterMock.saveState).not.toHaveBeenCalled();
    expect(credentialRollbackMock).toHaveBeenCalledWith('inference-endpoint:new');
  });
  it.each(['register', 'remove'] as const)('批量 %s 写盘失败时保留整个旧目录', async operation => {
    const original = buildUserModel('original', 'shared');
    persisterMock.loadState.mockResolvedValueOnce({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('shared')],
      models: [original],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    const before = registry.getModels();
    const revision = registry.getUserRevision();
    persisterMock.saveState.mockRejectedValueOnce(new Error('disk full'));
    const pending =
      operation === 'register'
        ? registry.registerUserModels(
            ['a', 'b'].map(id => ({
              model: buildUserModel(id, 'shared'),
              endpoint: { kind: 'existing', inference_endpoint_id: 'shared' },
            })),
            revision
          )
        : registry.applyDiff({ added: [], updated: [], removed: ['original'] }, revision);
    await expect(pending).rejects.toThrow('disk full');
    expect(registry.getModels()).toEqual(before);
    expect(registry.getUserRevision()).toBe(revision);
    expect(registry.getInferenceEndpoints().map(endpoint => endpoint.id)).toEqual(['shared']);
  });
  it('同批后续模型可引用刚创建的连接，密钥只写一次', async () => {
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();
    await registry.initialize(createSourceDistributionIdentity());
    credentialStoreMock.has.mockReturnValueOnce(false).mockReturnValue(true);
    await registry.registerUserModels(
      [
        {
          model: buildUserModel('first', 'new'),
          endpoint: {
            kind: 'create',
            endpoint: {
              id: 'new',
              route_profile_id: 'openai_chat',
              endpoint_id: 'deepseek',
              base_url: 'https://api.linnyai.com/proxy/deepseek',
              auth_profile: 'bearer',
              credential_secret: 'secret',
            },
          },
        },
        {
          model: buildUserModel('second', 'new'),
          endpoint: { kind: 'existing', inference_endpoint_id: 'new' },
        },
      ],
      registry.getUserRevision()
    );
    expect(registry.getModel('first')?.inference_endpoint_id).toBe('new');
    expect(registry.getModel('second')?.inference_endpoint_id).toBe('new');
    expect(credentialStoreMock.put).toHaveBeenCalledOnce();
    expect(persisterMock.saveState).toHaveBeenCalledOnce();
  });
});

describe('Registry 用户模型准入隔离与初始化回滚', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fetchCloudModelsMock.mockReset();
    persisterMock.initialize.mockClear();
    persisterMock.loadState.mockReset();
    persisterMock.saveState.mockReset();
    persisterMock.saveState.mockResolvedValue(undefined);
    credentialStoreMock.initialize.mockClear();
    credentialStoreMock.has.mockReturnValue(true);
    credentialStoreMock.getStatus.mockReturnValue('available');
    credentialStoreMock.put.mockClear();
    credentialStoreMock.remove.mockClear();
    credentialRollbackMock.mockClear();
    process.env.MODEL_REGISTRY_DEFAULTS_PATH = path.resolve(
      process.cwd(),
      'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** 旧版编辑接口拼出的双 route 用户模型：同一 endpoint 同时声明对话和向量 route。 */
  function buildDualRouteUserModel(id: string, endpointId: string): ModelConfig {
    const model = buildUserModel(id, endpointId);
    return {
      ...model,
      capabilities: ['chat', 'embedding'],
      embedding_route: {
        api_surface: 'openai_embeddings',
        capability_id: 'ai-sdk:openai-compatible-embeddings',
        endpoint_id: 'deepseek',
        endpoint_model_id: id,
        base_url: 'https://api.linnyai.com/proxy/deepseek',
        auth_profile: 'bearer',
        usage: { response_usage: 'provider_reported_optional' },
      },
    };
  }

  it('单个用户模型准入失败只停用它：其余模型可用，保存时原样带回原条目并保留它独占的连接与凭据', async () => {
    const broken = buildDualRouteUserModel('broken-user-model', 'broken-endpoint');
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [
        buildUserEndpoint('broken-endpoint'),
        buildUserEndpoint('healthy-endpoint'),
      ],
      models: [broken, buildUserModel('healthy-user-model', 'healthy-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await registry.initialize(createSourceDistributionIdentity());

    expect(registry.isInitialized()).toBe(true);
    expect(registry.getModel('healthy-user-model')).toBeDefined();
    expect(registry.getModel('broken-user-model')).toBeUndefined();
    expect(registry.getUnadmittedUserModels()).toEqual([
      {
        id: 'broken-user-model',
        inference_endpoint_id: 'broken-endpoint',
        custom_api_group_name: undefined,
        display_name: 'broken-user-model',
        reason: expect.stringContaining('必须声明唯一的推理 route'),
        // 类别在抛错处给出，界面据此显示白话原因。
        reason_kind: 'multiple_routes',
      },
    ]);
    expect(persisterMock.saveState).not.toHaveBeenCalled();
    // 启动对账（Provider 归属、选择器偏好）仍把停用模型当作存在。
    expect(registry.getModelIdentitiesIncludingUnadmitted()).toEqual(
      expect.arrayContaining([
        { id: 'healthy-user-model', inference_endpoint_id: 'healthy-endpoint' },
        { id: 'broken-user-model', inference_endpoint_id: 'broken-endpoint' },
      ])
    );

    // 删掉最后一个已准入模型：它的连接与凭据回收，停用模型的连接、凭据和原条目都不能被顺带删掉。
    await registry.removeModel('healthy-user-model');
    expect(persisterMock.saveState).toHaveBeenLastCalledWith(
      [],
      [expect.objectContaining({ id: 'broken-endpoint' })],
      [],
      [broken]
    );
    expect(credentialStoreMock.remove).toHaveBeenCalledWith('inference-endpoint:healthy-endpoint');
    expect(credentialStoreMock.remove).not.toHaveBeenCalledWith(
      'inference-endpoint:broken-endpoint'
    );
    expect(registry.getInferenceEndpoints()).toEqual([
      expect.objectContaining({ id: 'broken-endpoint' }),
    ]);
  });

  it('旧文件迁移时未通过准入的条目原样进入新文件', async () => {
    const broken = buildDualRouteUserModel('broken-user-model', 'shared-endpoint');
    const healthy = buildUserModel('healthy-user-model', 'shared-endpoint');
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: true,
      inferenceEndpoints: [buildUserEndpoint('shared-endpoint')],
      models: [broken, healthy],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await registry.initialize(createSourceDistributionIdentity());

    expect(persisterMock.saveState).toHaveBeenCalledOnce();
    expect(persisterMock.saveState).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'healthy-user-model' })],
      [expect.objectContaining({ id: 'shared-endpoint' })],
      [],
      [broken]
    );
  });

  it('同时发起的初始化共用一次载入：不报重复连接，失败的一方也不会回滚掉成功的结果', async () => {
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('healthy-endpoint')],
      models: [buildUserModel('healthy-user-model', 'healthy-endpoint')],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await Promise.all([
      registry.initialize(createSourceDistributionIdentity()),
      registry.initialize(createSourceDistributionIdentity()),
    ]);

    expect(persisterMock.loadState).toHaveBeenCalledOnce();
    expect(registry.isInitialized()).toBe(true);
    expect(registry.getModel('healthy-user-model')).toBeDefined();
    expect(registry.getInferenceEndpoints()).toEqual([
      expect.objectContaining({ id: 'healthy-endpoint' }),
    ]);
  });

  it('初始化失败时回滚已载入的连接：再次初始化报出真正原因，而不是重复连接', async () => {
    persisterMock.loadState.mockResolvedValue({
      customApiGroups: [{ name: 'Relay', inference_endpoint_ids: ['missing-endpoint'] }],
      requiresMigration: false,
      inferenceEndpoints: [buildUserEndpoint('loaded-endpoint')],
      models: [],
    });
    const { ModelCatalogRegistry } = await import('./modelCatalogRegistry');
    const registry = ModelCatalogRegistry.getInstance();

    await expect(registry.initialize(createSourceDistributionIdentity())).rejects.toThrow(
      '引用不存在的 InferenceEndpoint: missing-endpoint'
    );
    expect(registry.isInitialized()).toBe(false);
    expect(registry.getInferenceEndpoints()).toEqual([]);
    expect(registry.getModels()).toEqual([]);

    await expect(registry.initialize(createSourceDistributionIdentity())).rejects.toThrow(
      '引用不存在的 InferenceEndpoint: missing-endpoint'
    );
    expect(persisterMock.saveState).not.toHaveBeenCalled();
  });
});
