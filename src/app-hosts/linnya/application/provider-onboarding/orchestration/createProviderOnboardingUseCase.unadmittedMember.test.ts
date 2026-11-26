import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderConnectionDefinition,
  ProviderDefinition,
  ProviderModelDefinition,
} from '@linnya/provider-catalog';
import type { ProviderAccountModelDefinition } from 'src/domains/provider-account';

import type { ProviderOnboardingRuntimeBindingPort } from '../definitions/providerOnboardingPorts';
import { createStatefulProviderOnboardingStorage } from './__tests__/fixtures/providerOnboardingStateFixture';
import { createProviderOnboardingUseCase } from './createProviderOnboardingUseCase';

/**
 * Provider 归属里有启动时停用（未通过准入）的模型时，同一 Provider 的其余模型必须照常可用：
 * 停用成员不代表凭据边界，刷新、同步与过期清理都不碰它，它的归属原样留给修复或删除入口。
 */

const SHA = 'c'.repeat(64);

function providerModel(id: string) {
  return {
    id,
    display_name: id,
    release_status: 'active' as const,
    context_window_tokens: 256_000,
    max_input_tokens: 240_000,
    max_output_tokens: 16_000,
    capabilities: { image_input: false, tool_call: true, reasoning: false },
  };
}

const API_KEY_CONNECTION: ProviderConnectionDefinition = {
  id: 'openai-api',
  display_name: 'OpenAI API',
  kind: 'direct',
  release_status: 'stable',
  setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
  model_discovery: 'bundled',
  // 首次连接按名称启用前三个；gpt-d 留给之后手动添加。
  models: ['gpt-a', 'gpt-b', 'gpt-c', 'gpt-d'].map(providerModel),
};

const ACCOUNT_CONNECTION: ProviderConnectionDefinition = {
  id: 'openai-chatgpt-subscription',
  display_name: 'ChatGPT 订阅',
  kind: 'direct',
  release_status: 'preview',
  setup_fields: [
    { id: 'authorization', kind: 'oauth', required: true, label: '使用 ChatGPT 登录' },
  ],
  model_discovery: 'account_catalog',
  models: [],
};

const PROVIDER: ProviderDefinition = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [API_KEY_CONNECTION, ACCOUNT_CONNECTION],
};

const ACCOUNT_MODELS: readonly ProviderAccountModelDefinition[] = ['gpt-sol', 'gpt-terra'].map(
  id => ({
    id,
    display_name: id,
    context_window_tokens: 272_000,
    max_input_tokens: 258_400,
    max_output_tokens: 13_600,
    capabilities: { image_input: true, tool_call: true, reasoning: true },
  })
);

const RUNTIME_BINDINGS: ProviderOnboardingRuntimeBindingPort = {
  generation_id: 'generation-1',
  source_sha256: SHA,
  get: providerConnectionId => {
    if (providerConnectionId === API_KEY_CONNECTION.id) {
      return {
        provider_definition_id: 'openai',
        provider_connection_definition_id: API_KEY_CONNECTION.id,
        endpoint_id: 'openai',
        default_base_url: 'https://api.openai.com/v1',
        auth_profile: 'bearer',
        default_route_profile_id: 'openai_responses',
      };
    }
    if (providerConnectionId === ACCOUNT_CONNECTION.id) {
      return {
        provider_definition_id: 'openai',
        provider_connection_definition_id: ACCOUNT_CONNECTION.id,
        endpoint_id: 'chatgpt',
        default_base_url: 'https://chatgpt.com/backend-api/codex',
        auth_profile: 'bearer',
        default_route_profile_id: 'chatgpt_codex_responses',
      };
    }
    return undefined;
  },
};

function setup(
  account?: {
    readonly discoverModels: () => Promise<readonly ProviderAccountModelDefinition[]>;
  },
  /** 模拟在线发现返回的最新定义；不给时用安装包内的目录。 */
  latestDefinitions: { current?: readonly ProviderModelDefinition[] } = {}
) {
  const storage = createStatefulProviderOnboardingStorage();
  const removal = { remove: vi.fn(async (_modelConfigId: string) => undefined) };
  let id = 0;
  const useCase = createProviderOnboardingUseCase({
    discoveredModels: { readAvailable: () => latestDefinitions.current },
    providerCatalog: {
      generation: {
        id: 'generation-1',
        source_url: 'https://models.dev/api.json',
        source_sha256: SHA,
        synced_at: '2026-08-20T00:00:00.000Z',
        policy_version: 1,
      },
      getConnection: connectionId => {
        const connection = PROVIDER.connections.find(candidate => candidate.id === connectionId);
        return connection ? { provider: PROVIDER, connection } : undefined;
      },
    },
    runtimeBindings: RUNTIME_BINDINGS,
    modelCatalog: storage.catalog,
    providerConfigurations: storage.configurations,
    providerAccounts: {
      findConnectedAccountId: connectionId =>
        account && connectionId === ACCOUNT_CONNECTION.id ? 'chatgpt-account' : undefined,
    },
    accountModels: { discoverModels: account?.discoverModels ?? (async () => []) },
    modelRemoval: removal,
    idFactory: { create: () => `generated-${++id}` },
  });
  return { storage, useCase, removal };
}

function requireProviderMembers(storage: ReturnType<typeof createStatefulProviderOnboardingStorage>) {
  const members = storage.readConfiguredProvider()?.models;
  if (!members?.length) throw new Error('fixture provider has no members');
  return members;
}

describe('Provider 归属里有启动时停用的模型', () => {
  it('停用模型排在第一位时，换 Key、添加模型、刷新照常进行，停用成员的归属原样保留', async () => {
    const { storage, useCase } = setup();
    await useCase.configureDirectProvider({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'original-secret',
    });
    const [disabledMember] = requireProviderMembers(storage);
    const [endpoint] = storage.readEndpoints();
    if (!disabledMember || !endpoint) throw new Error('fixture provider was not configured');
    storage.disableAtRestart(disabledMember.model_config_id);

    // 换 Key：凭据边界从仍在目录里的成员确定，停用成员不会让它报配置损坏。
    await useCase.replaceDirectProviderCredential({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'rotated-secret',
    });
    expect(storage.catalog.replaceInferenceEndpointCredential).toHaveBeenCalledWith(
      endpoint.id,
      'rotated-secret'
    );

    // 添加模型：复用原连接，不新建第二条 endpoint，也不要求重新填 Key。
    await useCase.registerDirectProviderModel({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      provider_model_id: 'gpt-d',
    });
    expect(storage.readEndpoints().map(candidate => candidate.id)).toEqual([endpoint.id]);
    expect(storage.readModels().map(model => model.model_name)).toEqual(['gpt-b', 'gpt-c', 'gpt-d']);

    // 刷新：其余模型照常处理，停用成员不改写。
    await expect(
      useCase.refreshRegisteredProviderModels(API_KEY_CONNECTION.id)
    ).resolves.toBeUndefined();

    const members = requireProviderMembers(storage);
    expect(members[0]).toEqual(disabledMember);
    expect(members.map(member => member.provider_model_id)).toEqual([
      'gpt-a',
      'gpt-b',
      'gpt-c',
      'gpt-d',
    ]);
  });

  it('账号同步跳过停用成员：不改写、不当成未注册再建一条，也不当成过期模型删除', async () => {
    const discoverModels = vi
      .fn<() => Promise<readonly ProviderAccountModelDefinition[]>>()
      .mockResolvedValueOnce(ACCOUNT_MODELS)
      .mockResolvedValueOnce(ACCOUNT_MODELS.map(model => ({ ...model, max_output_tokens: 20_000 })))
      .mockResolvedValueOnce(ACCOUNT_MODELS.filter(model => model.id === 'gpt-terra'));
    const { storage, useCase, removal } = setup({ discoverModels });
    await useCase.synchronizeConnectedProviderModels(ACCOUNT_CONNECTION.id);
    const solMember = requireProviderMembers(storage).find(
      member => member.provider_model_id === 'gpt-sol'
    );
    if (!solMember) throw new Error('fixture account model missing');
    storage.disableAtRestart(solMember.model_config_id);

    // 目录里的 terra 照常更新；停用的 sol 既不更新，也不重新注册。
    await useCase.synchronizeConnectedProviderModels(ACCOUNT_CONNECTION.id);
    expect(storage.catalog.registerUserModel).toHaveBeenCalledTimes(2);
    expect(storage.readModels().map(model => model.inference_route?.max_output_tokens)).toEqual([
      20_000,
    ]);

    // 账号目录不再列出 sol：它是停用成员，不交给删除用例（删除用例会报“模型不存在”）。
    await useCase.synchronizeConnectedProviderModels(ACCOUNT_CONNECTION.id);
    expect(removal.remove).not.toHaveBeenCalled();
    expect(requireProviderMembers(storage).map(member => member.provider_model_id)).toEqual([
      'gpt-sol',
      'gpt-terra',
    ]);
  });

  it('归属指向既不在目录、也不是停用条目的模型时，仍按配置损坏报错', async () => {
    const { storage, useCase } = setup();
    await useCase.configureDirectProvider({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'original-secret',
    });
    const [danglingMember] = requireProviderMembers(storage);
    if (!danglingMember) throw new Error('fixture provider was not configured');
    storage.dropFromCatalogOnly(danglingMember.model_config_id);

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: API_KEY_CONNECTION.id,
        provider_model_id: 'gpt-d',
      })
    ).rejects.toMatchObject({
      code: 'provider_onboarding.configuration_invalid',
      statusCode: 500,
    });
    await expect(
      useCase.refreshRegisteredProviderModels(API_KEY_CONNECTION.id)
    ).rejects.toMatchObject({ code: 'provider_onboarding.configuration_invalid' });
  });

  it('全部成员停用时：换 Key 用停用成员的连接，刷新修复按最新定义重建同 ID，定义里已没有的保持停用', async () => {
    const latestDefinitions: { current?: readonly ProviderModelDefinition[] } = {};
    const { storage, useCase } = setup(undefined, latestDefinitions);
    await useCase.configureDirectProvider({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'original-secret',
    });
    const members = requireProviderMembers(storage);
    const [endpoint] = storage.readEndpoints();
    if (!endpoint) throw new Error('fixture provider was not configured');
    for (const member of members) storage.disableAtRestart(member.model_config_id);
    expect(storage.readModels()).toEqual([]);

    // 只剩停用成员：凭据边界就在它们引用的连接上，换 Key 不能报配置损坏。
    await useCase.replaceDirectProviderCredential({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'rotated-secret',
    });
    expect(storage.catalog.replaceInferenceEndpointCredential).toHaveBeenCalledWith(
      endpoint.id,
      'rotated-secret'
    );

    // 最新定义里 gpt-a 已经下架，gpt-b 的容量变了。
    const definitions = API_KEY_CONNECTION.models.filter(model => model.id !== 'gpt-a');
    latestDefinitions.current = definitions.map(model =>
      model.id === 'gpt-b' ? { ...model, max_output_tokens: 32_000 } : model
    );
    await expect(useCase.repairUnadmittedProviderModels(API_KEY_CONNECTION.id)).resolves.toEqual({
      repaired_model_count: 2,
      unrepairable_model_count: 1,
    });

    // 修复沿用原 model_config_id 与归属，复用原连接，资料来自最新定义。
    const [memberA, memberB, memberC] = members;
    expect(storage.readModels().map(model => model.id)).toEqual([
      memberB?.model_config_id,
      memberC?.model_config_id,
    ]);
    expect(storage.readModels().map(model => model.inference_endpoint_id)).toEqual([
      endpoint.id,
      endpoint.id,
    ]);
    expect(storage.readModels()[0]?.inference_route?.max_output_tokens).toBe(32_000);
    expect(storage.readEndpoints().map(candidate => candidate.id)).toEqual([endpoint.id]);
    expect(requireProviderMembers(storage)).toEqual(members);
    expect(storage.catalog.getUnadmittedUserModels().map(entry => entry.id)).toEqual([
      memberA?.model_config_id,
    ]);

    // 再刷新一次：仍下架的那条保持停用，不猜一个相近的模型代替。
    await expect(useCase.repairUnadmittedProviderModels(API_KEY_CONNECTION.id)).resolves.toEqual({
      repaired_model_count: 0,
      unrepairable_model_count: 1,
    });
    expect(storage.catalog.replaceUnadmittedUserModel).toHaveBeenCalledTimes(2);
  });

  it('账号目录型 Provider 的停用成员不能按定义修复（由账号同步重新注册），只能删除', async () => {
    const { useCase } = setup();
    await expect(
      useCase.repairUnadmittedProviderModels(ACCOUNT_CONNECTION.id)
    ).rejects.toMatchObject({ code: 'provider_onboarding.provider_not_supported' });
  });
});
