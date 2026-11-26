import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogGateway } from '../features/model-catalog';
import { useModelCatalogStore } from '../features/model-catalog';
import type { ModelPickerGateway } from '../features/model-picker';
import { useModelPickerStore } from '../features/model-picker/store/modelPickerStore';
import {
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { deleteConfiguredModel, deleteUnadmittedModel } from './deleteConfiguredModel';

describe('deleteConfiguredModel', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('后端删除成功后同时移除目录实体和所有显式用途绑定', async () => {
    const catalog = useModelCatalogStore();
    catalog.replaceSnapshot({
      models: [
        { id: 'custom-1', catalog_source: 'user', capabilities: ['chat', 'image_generation'] },
      ],
      purposeDefaults: {},
      cloudModelsReady: true,
    });
    setModelPurposeBinding('primary', 'custom-1');
    setModelPurposeBinding('image_generation', 'custom-1');
    setAuxiliaryModelPurposeBinding('translation', 'custom-1');

    const gateway: ModelCatalogGateway = {
      load: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const modelPickerGateway: ModelPickerGateway = {
      refreshProviderModels: vi.fn(),
      load: vi
        .fn()
        .mockResolvedValue({ providers: [], custom_models: [], unassigned_unadmitted_models: [] }),
      setProviderVisibility: vi.fn(),
      setModelVisibility: vi.fn(),
      activateProviderModel: vi.fn(),
    };
    await deleteConfiguredModel('custom-1', gateway, modelPickerGateway);

    const bindings = useModelPurposeBindings();
    expect(catalog.models).toEqual([]);
    expect(bindings.selections.primaryModelId.value).toBeNull();
    expect(bindings.selections.imageGenerationModelId.value).toBeNull();
    expect(bindings.selections.auxiliaryModelIds.value.translation).toBeNull();
  });
  it('删除提交后 Picker 重读失败不让详情界面误报删除失败', async () => {
    const catalog = useModelCatalogStore();
    catalog.replaceSnapshot({
      models: [{ id: 'a', catalog_source: 'user', capabilities: ['chat'] }],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    const gateway: ModelCatalogGateway = {
      load: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const picker: ModelPickerGateway = {
      load: vi.fn(async () => {
        throw new Error('offline');
      }),
      refreshProviderModels: vi.fn(),
      setProviderVisibility: vi.fn(),
      setModelVisibility: vi.fn(),
      activateProviderModel: vi.fn(),
    };
    await expect(deleteConfiguredModel('a', gateway, picker)).resolves.toBeUndefined();
    expect(catalog.models).toEqual([]);
  });

  it('删除停用条目：后端删除后不要求它在前端目录里，选择器重读后不再列出', async () => {
    const catalog = useModelCatalogStore();
    catalog.replaceSnapshot({
      models: [{ id: 'healthy', catalog_source: 'user', capabilities: ['chat'] }],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    const disabled = {
      model_config_id: 'disabled',
      display_name: 'Disabled',
      reason_kind: 'route_endpoint_mismatch' as const,
      reason: 'route mismatch',
      repairable: false,
    };
    useModelPickerStore().replaceSnapshot({
      providers: [],
      custom_models: [],
      unassigned_unadmitted_models: [disabled],
    });
    const gateway: ModelCatalogGateway = {
      load: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const picker: ModelPickerGateway = {
      load: vi.fn(async () => ({
        providers: [],
        custom_models: [],
        unassigned_unadmitted_models: [],
      })),
      refreshProviderModels: vi.fn(),
      setProviderVisibility: vi.fn(),
      setModelVisibility: vi.fn(),
      activateProviderModel: vi.fn(),
    };

    await expect(deleteUnadmittedModel('disabled', gateway, picker)).resolves.toBeUndefined();
    expect(gateway.delete).toHaveBeenCalledWith('disabled');
    expect(catalog.models.map(model => model.id)).toEqual(['healthy']);
    expect(catalog.error).toBeNull();
    expect(useModelPickerStore().snapshot?.unassigned_unadmitted_models).toEqual([]);
  });
});
