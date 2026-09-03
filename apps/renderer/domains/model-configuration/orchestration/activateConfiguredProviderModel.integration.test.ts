import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogGateway, ModelCatalogSnapshot } from '../features/model-catalog';
import { useModelCatalogStore } from '../features/model-catalog';
import { useModelPickerReadModel, type ModelPickerGateway } from '../features/model-picker';
import {
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { activateConfiguredProviderModel } from './activateConfiguredProviderModel';

const ACTIVATED_MODEL_ID = 'activated-model';

const activatedPickerSnapshot: ModelPickerSnapshot = {
  providers: [
    {
      configured_provider_id: 'configured-provider',
      provider_definition_id: 'provider',
      provider_connection_definition_id: 'provider-direct',
      display_name: 'Provider',
      connection_display_name: 'API Key',
      kind: 'direct',
      picker_enabled: true,
      credential_available: true,
      models: [
        {
          materialized: true,
          model_config_id: ACTIVATED_MODEL_ID,
          provider_model_id: 'provider-model',
          display_name: 'Activated model',
          picker_enabled: true,
          runtime_available: true,
          capabilities: ['chat'],
          image_input: false,
        },
      ],
    },
  ],
  custom_models: [],
};

const activatedCatalogSnapshot: ModelCatalogSnapshot = {
  models: [
    {
      id: ACTIVATED_MODEL_ID,
      catalog_source: 'user',
      display_name: 'Activated model',
      model_name: 'provider-model',
      capabilities: ['chat'],
      ui_visibility: [],
    },
  ],
  purposeDefaults: {},
  cloudModelsReady: true,
};

describe('activateConfiguredProviderModel', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('激活 Provider 模型后同步目录与选择器，并可立即设为主模型', async () => {
    let hostActivationCompleted = false;
    const modelPickerGateway: ModelPickerGateway = {
      load: vi.fn(),
      setProviderVisibility: vi.fn(),
      setModelVisibility: vi.fn(),
      activateProviderModel: vi.fn().mockImplementation(async () => {
        hostActivationCompleted = true;
        return activatedPickerSnapshot;
      }),
    };
    const modelCatalogGateway: ModelCatalogGateway = {
      load: vi.fn().mockImplementation(async () => {
        if (!hostActivationCompleted) throw new Error('模型目录刷新早于 Host 激活完成');
        return activatedCatalogSnapshot;
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };

    await activateConfiguredProviderModel(
      'configured-provider',
      'provider-model',
      modelCatalogGateway,
      modelPickerGateway
    );

    expect(useModelPickerReadModel().snapshot.value).toEqual(activatedPickerSnapshot);
    expect(useModelCatalogStore().models.map(model => model.id)).toEqual([ACTIVATED_MODEL_ID]);
    expect(() => setModelPurposeBinding('primary', ACTIVATED_MODEL_ID)).not.toThrow();
    expect(useModelPurposeBindings().selections.primaryModelId.value).toBe(ACTIVATED_MODEL_ID);
  });
});
