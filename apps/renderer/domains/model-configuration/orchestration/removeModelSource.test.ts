import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore, type ModelCatalogGateway } from '../features/model-catalog';
import type { ModelPickerGateway } from '../features/model-picker';
import {
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { removeModelSource } from './removeModelSource';

function setup() {
  useModelCatalogStore().replaceSnapshot({
    models: ['a', 'b', 'c'].map(id => ({ id, catalog_source: 'user', capabilities: ['chat'] })),
    purposeDefaults: {},
    cloudModelsReady: false,
  });
  setModelPurposeBinding('primary', 'a');
  const catalog: ModelCatalogGateway = {
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
    activateProviderModel: vi.fn(),
    setModelVisibility: vi.fn(),
    setProviderVisibility: vi.fn(),
  };
  return { catalog, picker };
}

describe('removeModelSource', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('依次删除并清理绑定，整批结束只同步一次列表', async () => {
    const { catalog, picker } = setup();
    expect(
      await removeModelSource(
        { modelConfigIds: ['a', 'b'], unadmittedModelConfigIds: [] },
        catalog,
        picker
      )
    ).toEqual({
      removedModelIds: ['a', 'b'],
      failure: null,
      synchronizationFailed: false,
    });
    expect(catalog.delete).toHaveBeenNthCalledWith(1, 'a');
    expect(catalog.delete).toHaveBeenNthCalledWith(2, 'b');
    expect(picker.load).toHaveBeenCalledOnce();
    expect(useModelPurposeBindings().selections.primaryModelId.value).toBeNull();
  });

  it('中途删除失败仍同步已完成部分，返回真实完成量和失败模型', async () => {
    const { catalog, picker } = setup();
    const error = new Error('host rejected deletion');
    vi.mocked(catalog.delete).mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
    expect(
      await removeModelSource(
        { modelConfigIds: ['a', 'b', 'c'], unadmittedModelConfigIds: [] },
        catalog,
        picker
      )
    ).toEqual({
      removedModelIds: ['a'],
      failure: { modelId: 'b', error },
      synchronizationFailed: false,
    });
    expect(catalog.delete).toHaveBeenCalledTimes(2);
    expect(picker.load).toHaveBeenCalledOnce();
    expect(useModelCatalogStore().models.map(model => model.id)).toEqual(['b', 'c']);
  });

  it('停用条目只删后端、不动前端 catalog；与已准入模型同批删除时一起计入回执', async () => {
    const { catalog, picker } = setup();

    expect(
      await removeModelSource(
        { modelConfigIds: ['a'], unadmittedModelConfigIds: ['disabled'] },
        catalog,
        picker
      )
    ).toEqual({ removedModelIds: ['a', 'disabled'], failure: null, synchronizationFailed: false });
    expect(catalog.delete).toHaveBeenNthCalledWith(1, 'a');
    expect(catalog.delete).toHaveBeenNthCalledWith(2, 'disabled');
    // 停用条目从未进入前端 catalog：删除它不能触发“待删除模型不在目录中”。
    expect(useModelCatalogStore().models.map(model => model.id)).toEqual(['b', 'c']);
    expect(useModelCatalogStore().error).toBeNull();
    expect(picker.load).toHaveBeenCalledOnce();
  });
});
