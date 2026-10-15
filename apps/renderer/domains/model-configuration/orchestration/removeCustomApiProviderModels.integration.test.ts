import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomApiProviderRemovalGateway } from '../features/custom-model-registration';
import { useModelCatalogStore, type ModelCatalogGateway } from '../features/model-catalog';
import { useModelPickerReadModel, type ModelPickerGateway } from '../features/model-picker';
import { useModelPickerStore } from '../features/model-picker/store/modelPickerStore';
import {
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { removeCustomApiProviderModels } from './removeCustomApiProviderModels';

describe('删除自定义分组后的 Renderer 同步', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('清理 Host 实际删除模型的绑定，重读失败独立报告且不重发删除', async () => {
    useModelCatalogStore().replaceSnapshot({
      models: [{ id: 'a', catalog_source: 'user', capabilities: ['chat'] }],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    setModelPurposeBinding('primary', 'a');
    const removal: CustomApiProviderRemovalGateway = {
      removeProvider: vi.fn(async () => ({
        removed_model_ids: ['a', 'b'],
        model_picker_preference_recovery_pending: false,
      })),
    };
    const catalog: ModelCatalogGateway = {
      load: vi.fn(async () => {
        throw new Error('offline');
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const picker: ModelPickerGateway = {
      load: vi.fn(async () => ({ providers: [], custom_models: [] })),
      refreshProviderModels: vi.fn(),
      activateProviderModel: vi.fn(),
      setModelVisibility: vi.fn(),
      setProviderVisibility: vi.fn(),
    };
    await expect(removeCustomApiProviderModels('Relay', removal, catalog, picker)).resolves.toEqual(
      { synchronizationFailed: true }
    );
    expect(useModelPurposeBindings().selections.primaryModelId.value).toBeNull();
    expect(removal.removeProvider).toHaveBeenCalledExactlyOnceWith({ provider_name: 'Relay' });
    expect(picker.load).toHaveBeenCalledOnce();
  });

  it('空分组删除回执不含模型 ID，后续 GET 失败也不能留下已删除的来源入口', async () => {
    useModelPickerStore().replaceSnapshot({
      providers: [],
      custom_models: [],
      custom_providers: [{
        provider_id: 'custom:Relay',
        provider_name: 'Relay',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example/v1',
        models: [],
      }],
    });
    const removal: CustomApiProviderRemovalGateway = {
      removeProvider: vi.fn(async () => ({
        removed_model_ids: [],
        model_picker_preference_recovery_pending: false,
      })),
    };
    const catalog: ModelCatalogGateway = {
      load: vi.fn(async () => ({ models: [], purposeDefaults: {}, cloudModelsReady: false })),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const picker: ModelPickerGateway = {
      load: vi.fn(async () => { throw new Error('picker unavailable'); }),
      refreshProviderModels: vi.fn(),
      activateProviderModel: vi.fn(),
      setModelVisibility: vi.fn(),
      setProviderVisibility: vi.fn(),
    };

    await expect(removeCustomApiProviderModels('Relay', removal, catalog, picker))
      .resolves.toEqual({ synchronizationFailed: true });
    expect(useModelPickerReadModel().snapshot.value?.custom_providers).toEqual([]);
    expect(removal.removeProvider).toHaveBeenCalledExactlyOnceWith({ provider_name: 'Relay' });
    expect(picker.load).toHaveBeenCalledOnce();
  });
});
