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
  const applyDiff = vi.fn(async () => undefined);
  const removeModelPreferences = vi.fn(async () => undefined);
  const dependencies: CustomApiOnboardingDependencies = {
    modelCatalog: {
      getModels: () => models,
      getInferenceEndpoints: () => [],
      getUserRevision: () => 7,
      resolveCredential: vi.fn(),
      registerUserModels: vi.fn(),
      rebindUserModels: vi.fn(),
      applyDiff,
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
  return { dependencies, applyDiff, removeModelPreferences };
}

describe('删除自定义分组', () => {
  it('按后端当前归属一次删除整组，排除正式 Provider 和其他分组', async () => {
    const { dependencies, applyDiff, removeModelPreferences } = setup();
    await expect(
      removeCustomApiProvider({ provider_name: 'Relay' }, dependencies)
    ).resolves.toEqual({
      removed_model_ids: ['a', 'b'],
      model_picker_preference_recovery_pending: false,
    });
    expect(applyDiff).toHaveBeenCalledExactlyOnceWith(
      { added: [], updated: [], removed: ['a', 'b'] },
      7
    );
    expect(removeModelPreferences).toHaveBeenCalledWith(['a', 'b']);
  });

  it('目录冲突时保留偏好，目录已删除后的偏好失败则报告成功并等待启动清理', async () => {
    const { dependencies, applyDiff, removeModelPreferences } = setup();
    applyDiff.mockRejectedValueOnce(new ModelCatalogConflictError());
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
