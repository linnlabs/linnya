import { describe, expect, it, vi } from 'vitest';
import { ModelCatalogConflictError, type ModelConfig } from 'src/domains/model-catalog';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { removeCustomApiProvider } from './removeCustomApiProvider';

function setup() {
  const models: ModelConfig[] = ['a', 'b', 'formal', 'other'].map(id => ({
    id,
    model_name: id,
    display_name: id,
    description: '',
    capabilities: [],
    ui_visibility: [],
    catalog_source: 'user',
    custom_provider_name: id === 'other' ? 'Other' : 'Relay',
  }));
  const removeCustomApiGroup = vi.fn(async () => undefined);
  const removeModelPreferences = vi.fn(async () => undefined);
  const dependencies: CustomApiOnboardingDependencies = {
    modelCatalog: {
      getModels: () => models,
      getInferenceEndpoints: () => [],
      getUserRevision: () => 7,
      getUnadmittedUserModels: () => [],
      applyCustomApiGroupModelDiff: vi.fn(),
      getCustomApiGroups: () => [{ name: 'Relay', inference_endpoint_ids: ['relay'] }],
      resolveInferenceEndpointCredential: vi.fn(),
      registerCustomApiModels: vi.fn(),
      rebindCustomApiGroup: vi.fn(),
      removeCustomApiGroup,
    },
    providerMembership: {
      getByModelConfigId: id =>
        id === 'formal'
          ? {
              id: 'configured',
              provider_definition_id: 'ollama',
              provider_connection_definition_id: 'ollama-local',
              models: [],
            }
          : undefined,
    },
    modelPickerPreferences: { setModelVisibilities: vi.fn(), removeModelPreferences },
    modelDiscovery: { discover: vi.fn() },
    idFactory: { create: () => 'unused' },
  };
  return { dependencies, removeCustomApiGroup, removeModelPreferences };
}

describe('删除自定义分组', () => {
  it('空分组可显式删除，返回空删除列表而不遗留连接', async () => {
    const { dependencies, removeCustomApiGroup, removeModelPreferences } = setup();
    dependencies.modelCatalog.getModels = () => [];
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).resolves.toEqual({
      removed_model_ids: [],
      model_picker_preference_recovery_pending: false,
    });
    expect(removeCustomApiGroup).toHaveBeenCalledExactlyOnceWith('Relay', 7);
    expect(removeModelPreferences).not.toHaveBeenCalled();
  });

  it('按后端当前归属一次删除整组，排除正式 Provider 和其他分组', async () => {
    const { dependencies, removeCustomApiGroup, removeModelPreferences } = setup();
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).resolves.toEqual({
      removed_model_ids: ['a', 'b'],
      model_picker_preference_recovery_pending: false,
    });
    expect(removeCustomApiGroup).toHaveBeenCalledExactlyOnceWith('Relay', 7);
    expect(removeModelPreferences).toHaveBeenCalledWith(['a', 'b']);
  });

  it('分组里配置无效的条目随分组删除，其 ID 一并交回清理偏好；未归类与其他分组的不受影响', async () => {
    const { dependencies, removeModelPreferences } = setup();
    const unadmitted = (id: string, group: string | undefined) => ({
      id,
      inference_endpoint_id: 'relay',
      custom_api_group_name: group,
      display_name: id,
      reason: '用户模型必须声明唯一的推理 route',
      reason_kind: 'multiple_routes' as const,
    });
    dependencies.modelCatalog.getUnadmittedUserModels = () => [
      unadmitted('broken', 'Relay'),
      unadmitted('orphan', undefined),
      unadmitted('elsewhere', 'Other'),
    ];
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).resolves.toEqual({
      removed_model_ids: ['a', 'b', 'broken'],
      model_picker_preference_recovery_pending: false,
    });
    expect(removeModelPreferences).toHaveBeenCalledWith(['a', 'b', 'broken']);
  });

  it('目录冲突时保留偏好，目录已删除后的偏好失败则报告成功并等待启动清理', async () => {
    const { dependencies, removeCustomApiGroup, removeModelPreferences } = setup();
    removeCustomApiGroup.mockRejectedValueOnce(new ModelCatalogConflictError());
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).rejects.toMatchObject({
      code: 'custom_api_onboarding.configuration_changed',
      statusCode: 409,
    });
    expect(removeModelPreferences).not.toHaveBeenCalled();
    removeModelPreferences.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).resolves.toEqual({
      removed_model_ids: ['a', 'b'],
      model_picker_preference_recovery_pending: true,
    });
  });
});
