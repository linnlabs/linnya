import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogGateway } from '../features/model-catalog';
import { useModelCatalogStore } from '../features/model-catalog';
import type { ModelPickerGateway } from '../features/model-picker';
import {
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { deleteConfiguredModel } from './deleteConfiguredModel';

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
      load: vi.fn().mockResolvedValue({ providers: [], custom_models: [] }),
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
});
