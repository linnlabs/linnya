import { createPinia, setActivePinia } from 'pinia';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomApiProviderRefreshGateway } from '../features/custom-model-registration';
import {
  useModelCatalogStore,
  type ModelCatalogGateway,
  type ModelCatalogSnapshot,
} from '../features/model-catalog';
import { useModelPickerReadModel, type ModelPickerGateway } from '../features/model-picker';
import { useModelPickerStore } from '../features/model-picker/store/modelPickerStore';
import {
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  setPrimaryReasoningEffort,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { refreshCustomApiProviderModels } from './refreshCustomApiProviderModels';

function setup() {
  const initialCatalog: ModelCatalogSnapshot = {
    models: ['removed', 'retained'].map(id => ({
      id,
      catalog_source: 'user',
      capabilities: ['chat', 'image_generation', 'embedding'],
      reasoning: { supported_efforts: ['low', 'high'] },
    })),
    purposeDefaults: {},
    cloudModelsReady: false,
  };
  useModelCatalogStore().replaceSnapshot(initialCatalog);
  const initialPicker: ModelPickerSnapshot = {
    providers: [],
    custom_models: ['removed', 'retained'].map(id => ({
      materialized: true,
      model_config_id: id,
      display_name: id,
      capabilities: ['chat'],
      picker_enabled: true,
      runtime_available: true,
      image_input: false,
    })),
    custom_providers: [],
  };
  initialPicker.custom_providers = initialPicker.custom_models.map(model => ({
    provider_id: `custom:${model.model_config_id}`,
    provider_name: model.model_config_id,
    models: [model],
  }));
  useModelPickerStore().replaceSnapshot(initialPicker);
  setModelPurposeBinding('primary', 'retained');
  setPrimaryReasoningEffort('high');
  setModelPurposeBinding('primary', 'removed');
  setPrimaryReasoningEffort('low');
  setModelPurposeBinding('image_generation', 'removed');
  setModelPurposeBinding('embedding', 'retained');
  setAuxiliaryModelPurposeBinding('translation', 'removed');
  setAuxiliaryModelPurposeBinding('writing', 'retained');
  const bindings = useModelPurposeBindings();
  const refresh: CustomApiProviderRefreshGateway = {
    refreshProvider: vi.fn(async () => ({
      provider_name: 'Relay',
      added_model_ids: ['added'],
      removed_model_ids: ['removed'],
      model_picker_preference_recovery_pending: false,
    })),
  };
  const catalog: ModelCatalogGateway = {
    load: vi.fn(async () => {
      // 删除事实先于投影读取生效；读取失败也不能跳过此清理。
      expect(bindings.selections.primaryModelId.value).toBeNull();
      return {
        ...initialCatalog,
        models: [
          ...initialCatalog.models.filter(model => model.id === 'retained'),
          { id: 'added', catalog_source: 'user', capabilities: ['chat'] },
        ],
      } satisfies ModelCatalogSnapshot;
    }),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const picker: ModelPickerGateway = {
    load: vi.fn(async () => ({
      ...initialPicker,
      custom_models: initialPicker.custom_models.filter(model => model.model_config_id !== 'removed'),
      custom_providers: initialPicker.custom_providers?.map(group => ({
        ...group,
        models: group.models.filter(model => model.model_config_id !== 'removed'),
      })),
    })),
    refreshProviderModels: vi.fn(),
    setProviderVisibility: vi.fn(),
    setModelVisibility: vi.fn(),
    activateProviderModel: vi.fn(),
  };
  return { refresh, catalog, picker, bindings };
}

describe('自定义分组远端快照同步后的 Renderer 清理', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('只清理 Host 实际删除模型的绑定，存续模型的用途与 reasoning 选择保持不变', async () => {
    const { refresh, catalog, picker, bindings } = setup();
    await refreshCustomApiProviderModels('Relay', 'Relay', refresh, catalog, picker);

    expect(bindings.selections.primaryModelId.value).toBeNull();
    expect(bindings.selections.primaryReasoningEffort.value).toBeNull();
    expect(bindings.selections.imageGenerationModelId.value).toBeNull();
    expect(bindings.selections.auxiliaryModelIds.value.translation).toBeNull();
    expect(bindings.selections.embeddingModelId.value).toBe('retained');
    expect(bindings.selections.auxiliaryModelIds.value.writing).toBe('retained');
    setModelPurposeBinding('primary', 'retained');
    expect(bindings.selections.primaryReasoningEffort.value).toBe('high');
    expect(useModelCatalogStore().models.map(model => model.id)).toEqual(['retained', 'added']);
    expect(refresh.refreshProvider).toHaveBeenCalledExactlyOnceWith({ provider_name: 'Relay' });
    expect(picker.setModelVisibility).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'picker'] as const)(
    '提交成功但 %s 重读失败时仍清理失效绑定，明确保留已刷新事实',
    async failedRead => {
      const { refresh, catalog, picker, bindings } = setup();
      const rejectRead = vi.fn(async () => {
        expect(bindings.selections.primaryModelId.value).toBeNull();
        throw new Error('read unavailable');
      });
      if (failedRead === 'catalog') catalog.load = rejectRead;
      else picker.load = rejectRead;

      await expect(
        refreshCustomApiProviderModels('Relay', 'Relay', refresh, catalog, picker)
      ).rejects.toThrow('模型已刷新，但列表同步失败');

      expect(bindings.selections.primaryModelId.value).toBeNull();
      expect(bindings.selections.auxiliaryModelIds.value.translation).toBeNull();
      expect(bindings.selections.embeddingModelId.value).toBe('retained');
      expect(bindings.effectivePrimaryModelId.value).toBe('retained');
      expect(useModelCatalogStore().models.map(model => model.id)).not.toContain('removed');
      const pickerSnapshot = useModelPickerReadModel().snapshot.value;
      expect(pickerSnapshot?.custom_models.map(model => model.model_config_id)).toEqual(['retained']);
      expect(pickerSnapshot?.custom_providers?.find(group => group.provider_name === 'removed'))
        .toMatchObject({ models: [] });
      expect(pickerSnapshot?.custom_providers?.flatMap(group => group.models.map(model => model.model_config_id)))
        .not.toContain('removed');
      expect(catalog.load).toHaveBeenCalledOnce();
      expect(picker.load).toHaveBeenCalledOnce();
      expect(refresh.refreshProvider).toHaveBeenCalledOnce();
      expect(useModelPickerReadModel().error.value).toEqual({
        operation: 'load',
        detail: null,
        outcome: 'source-refreshed-synchronization-failed',
        sourceLabel: 'Relay',
      });
    }
  );

  it('Host 刷新失败时保持所有选择，不启动后续投影读取', async () => {
    const { refresh, catalog, picker, bindings } = setup();
    vi.mocked(refresh.refreshProvider).mockRejectedValue(new Error('鉴权失败'));
    await expect(
      refreshCustomApiProviderModels('Relay', 'Relay', refresh, catalog, picker)
    ).rejects.toThrow('鉴权失败');
    expect(bindings.selections.primaryModelId.value).toBe('removed');
    expect(bindings.selections.primaryReasoningEffort.value).toBe('low');
    expect(bindings.selections.auxiliaryModelIds.value.translation).toBe('removed');
    expect(catalog.load).not.toHaveBeenCalled();
    expect(picker.load).not.toHaveBeenCalled();
    expect(useModelPickerReadModel().error.value?.detail).toBe('Relay: 鉴权失败');
  });
});
