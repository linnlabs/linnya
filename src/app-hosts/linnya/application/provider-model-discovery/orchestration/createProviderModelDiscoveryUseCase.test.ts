import { describe, expect, it, vi } from 'vitest';
import { providerCatalog, type ProviderModelDefinition } from '@linnya/provider-catalog';
import { providerOnboardingRuntimeBindingRegistry } from 'src/app-hosts/linnya/adapters/inference';
import {
  ProviderModelDiscoveryError,
  type ProviderDiscoveredModel,
} from 'src/app-hosts/linnya/adapters/provider-model-discovery';
import type {
  InferenceEndpointView,
  ModelConfig,
  UnadmittedUserModel,
} from 'src/domains/model-catalog';
import { createProviderModelDiscoveryUseCase } from './createProviderModelDiscoveryUseCase';
import { createModelPickerUseCase } from '../../model-picker';

const freshModel: ProviderModelDefinition = {
  id: 'new-flash',
  display_name: 'New Flash',
  release_status: 'active',
  context_window_tokens: 1_000_000,
  max_input_tokens: 1_000_000,
  max_output_tokens: 100_000,
  capabilities: { image_input: true, tool_call: true, reasoning: true },
};

function endpointView(id: string): InferenceEndpointView {
  return {
    id,
    route_profile_id: 'deepseek_chat',
    endpoint_id: `deepseek:${id}`,
    base_url: 'https://api.deepseek.com',
    auth_profile: 'bearer',
    credential_reference: { kind: 'stored_secret', credential_id: 'configured-provider:fixture' },
    credential_status: 'configured',
  };
}

function catalogModel(id: string): ModelConfig {
  return {
    id,
    model_name: id,
    display_name: id,
    description: '',
    catalog_source: 'user',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
  };
}

function fixture(catalogModelIds: readonly string[] = ['existing']) {
  const configured = {
    id: 'configured-deepseek',
    provider_definition_id: 'deepseek',
    provider_connection_definition_id: 'deepseek',
    models: [{ model_config_id: 'existing', provider_model_id: 'old-flash' }],
  };
  let currentConfigured: typeof configured | undefined = configured;
  const resolveCredential = vi.fn((_modelConfigId: string) => 'fixture-secret');
  const resolveInferenceEndpointCredential = vi.fn((_endpointId: string) => 'endpoint-secret');
  let unadmitted: UnadmittedUserModel[] = [];
  const discover = vi.fn<() => Promise<readonly ProviderDiscoveredModel[]>>();
  const discovery = createProviderModelDiscoveryUseCase({
    catalog: providerCatalog,
    bindings: providerOnboardingRuntimeBindingRegistry,
    configurations: { getByProviderConnectionDefinitionId: () => currentConfigured },
    models: {
      getModel: id => (catalogModelIds.includes(id) ? catalogModel(id) : undefined),
      resolveCredential,
      getUnadmittedUserModels: () => unadmitted,
      getInferenceEndpoints: () => [endpointView('member-endpoint')],
      resolveInferenceEndpointCredential,
    },
    discovery: { supports: id => id === 'deepseek', discover },
  });
  return {
    configured,
    resolveCredential,
    resolveInferenceEndpointCredential,
    discover,
    discovery,
    setUnadmitted(value: UnadmittedUserModel[]) {
      unadmitted = value;
    },
    setConfigured(value: typeof configured | undefined) {
      currentConfigured = value;
    },
  };
}

describe('正式 Provider 在线发现交接', () => {
  it('真实候选替换 bundled，并通过相同候选身份启用；资料不足和跨供应商 ID 均被拒绝', async () => {
    const target = fixture();
    target.discover.mockResolvedValue([
      { status: 'available', definition: freshModel },
      {
        status: 'unavailable',
        id: 'unknown-limit',
        display_name: 'Unknown',
        reason: '缺少输出上限',
      },
    ]);
    const register = vi.fn();
    const picker = createModelPickerUseCase({
      providerCatalog,
      discoveredModels: target.discovery,
      providerModelRefresh: {
        supports: target.discovery.supports,
        refresh: target.discovery.refresh,
      },
      providerConfigurations: {
        list: () => [target.configured],
        getByModelConfigId: () => undefined,
      },
      modelCatalog: {
        getModels: () => [],
        getUnadmittedUserModels: () => [],
        getModel: () => undefined,
        getInferenceEndpoints: () => [],
        getCustomApiGroups: () => [],
        hasCredential: () => true,
        getCredentialStatus: () => 'available',
      },
      providerAccounts: {
        list: () => [],
        hasCredential: () => false,
        getCredentialStatus: () => 'missing',
      },
      preferences: {
        read: () => ({ provider_preferences: [], model_preferences: [] }),
        setProviderVisibility: vi.fn(),
        setModelVisibility: vi.fn(),
      },
      providerModelActivation: { registerDirectProviderModel: register },
      providerModelRepair: { repairUnadmittedProviderModels: vi.fn() },
    });
    const result = await picker.refreshProviderModels(target.configured.id);
    expect(target.discover).toHaveBeenCalledOnce();
    expect(result.providers[0]?.models.map(model => model.provider_model_id)).toEqual([
      'new-flash',
      'unknown-limit',
    ]);
    expect(result.providers[0]?.models[1]).toMatchObject({
      activation_unavailable_reason: '缺少输出上限',
    });
    await picker.activateProviderModel(target.configured.id, 'new-flash');
    expect(register).toHaveBeenCalledWith({
      provider_connection_definition_id: 'deepseek',
      provider_model_id: 'new-flash',
    });
    for (const id of ['unknown-limit', 'foreign-id']) {
      await expect(picker.activateProviderModel(target.configured.id, id)).rejects.toMatchObject({
        code: 'model_picker.provider_model_not_found',
      });
    }
    expect(register).toHaveBeenCalledOnce();
  });

  it('后续网络失败或取消不发布部分候选，空的成功结果可以替换旧候选', async () => {
    const target = fixture();
    const initial: readonly ProviderDiscoveredModel[] = [
      { status: 'available', definition: freshModel },
    ];
    target.discover
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new ProviderModelDiscoveryError('取得失败', 502))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await target.discovery.refresh('deepseek');
    await expect(target.discovery.refresh('deepseek')).rejects.toThrow('取得失败');
    expect(target.discovery.read('deepseek')).toBe(initial);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(target.discovery.refresh('deepseek', cancelled.signal)).rejects.toThrow();
    expect(target.discovery.read('deepseek')).toBe(initial);
    await target.discovery.refresh('deepseek');
    expect(target.discovery.readAvailable('deepseek')).toEqual([]);
  });

  it('删除或重连后不沿用旧候选，查询途中连接改变也不发布旧响应', async () => {
    const target = fixture();
    target.discover.mockResolvedValue([]);
    await target.discovery.refresh('deepseek');
    expect(target.discovery.readAvailable('deepseek')).toEqual([]);
    target.setConfigured(undefined);
    expect(target.discovery.read('deepseek')).toBeUndefined();
    target.setConfigured({ ...target.configured, id: 'reconnected' });
    expect(target.discovery.read('deepseek')).toBeUndefined();
    target.discover.mockImplementation(async () => {
      target.setConfigured({ ...target.configured, id: 'changed-during-query' });
      return [{ status: 'available', definition: freshModel }];
    });
    await expect(target.discovery.refresh('deepseek')).rejects.toMatchObject({ statusCode: 409 });
    expect(target.discovery.read('deepseek')).toBeUndefined();
  });

  it('排在第一位的成员启动时停用，凭据取第一个仍在目录里的成员', async () => {
    const target = fixture(['healthy']);
    target.setConfigured({
      ...target.configured,
      models: [
        { model_config_id: 'disabled-at-startup', provider_model_id: 'old-flash' },
        { model_config_id: 'healthy', provider_model_id: 'new-flash' },
      ],
    });
    target.discover.mockResolvedValue([{ status: 'available', definition: freshModel }]);

    await target.discovery.refresh('deepseek');

    expect(target.resolveCredential).toHaveBeenCalledWith('healthy');
    expect(target.resolveCredential).not.toHaveBeenCalledWith('disabled-at-startup');
    expect(target.discover).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'fixture-secret' })
    );
  });

  it('成员全部启动时停用，凭据取停用成员仍在的连接；连接已不存在的停用成员不算', async () => {
    const target = fixture([]);
    target.setConfigured({
      ...target.configured,
      models: [
        { model_config_id: 'endpoint-gone', provider_model_id: 'old-flash' },
        { model_config_id: 'disabled-flash', provider_model_id: 'new-flash' },
      ],
    });
    const entry = (id: string, endpointId: string): UnadmittedUserModel => ({
      id,
      inference_endpoint_id: endpointId,
      custom_api_group_name: undefined,
      display_name: id,
      reason: 'route mismatch',
      reason_kind: 'route_endpoint_mismatch',
    });
    target.setUnadmitted([
      entry('endpoint-gone', 'deleted-endpoint'),
      entry('disabled-flash', 'member-endpoint'),
    ]);
    target.discover.mockResolvedValue([{ status: 'available', definition: freshModel }]);

    await target.discovery.refresh('deepseek');

    expect(target.resolveCredential).not.toHaveBeenCalled();
    expect(target.resolveInferenceEndpointCredential).toHaveBeenCalledWith('member-endpoint');
    expect(target.discover).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'endpoint-secret' })
    );

    target.setUnadmitted([]);
    await expect(target.discovery.refresh('deepseek')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('凭据不可用时明确失败，不把空 Key 发往供应商', async () => {
    const target = fixture();
    target.resolveCredential.mockReturnValue('');
    await expect(target.discovery.refresh('deepseek')).rejects.toMatchObject({ statusCode: 401 });
    expect(target.discover).not.toHaveBeenCalled();
    expect(target.discovery.read('deepseek')).toBeUndefined();
  });
});
