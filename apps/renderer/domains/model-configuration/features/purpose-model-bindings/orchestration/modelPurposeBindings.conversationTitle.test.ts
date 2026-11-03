import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useModelCatalogStore, type ModelCatalogItem } from '../../model-catalog';
import { useModelPurposeBindingsStore } from '../store/modelPurposeBindingsStore';
import {
  clearBindingsForModel,
  readEffectiveAuxiliaryModelPurposeBinding,
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  useModelPurposeBindings,
} from './modelPurposeBindings';

const TITLE = 'conversation_title';

function chatModel(id: string): ModelCatalogItem {
  return { id, catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] };
}

function loadCatalog(models: readonly ModelCatalogItem[]): void {
  useModelCatalogStore().replaceSnapshot({
    models,
    purposeDefaults: {},
    cloudModelsReady: false,
  });
}

describe('对话标题模型的有效绑定', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('没有单独选择标题模型时使用主模型，且不向用户配置写入任何模型 ID', () => {
    loadCatalog([chatModel('main'), chatModel('title-flash')]);
    setModelPurposeBinding('primary', 'main');

    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('main');
    expect(useModelPurposeBindingsStore().auxiliaryModelIds).toEqual({});

    setModelPurposeBinding('primary', 'title-flash');
    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('title-flash');
    expect(useModelPurposeBindingsStore().auxiliaryModelIds).toEqual({});
  });

  it('用户显式选择标题模型后，标题使用所选模型而不是主模型', () => {
    loadCatalog([chatModel('main'), chatModel('title-flash')]);
    setModelPurposeBinding('primary', 'main');

    setAuxiliaryModelPurposeBinding(TITLE, 'title-flash');

    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('title-flash');
  });

  it('选择过标题模型后可以回到跟随主模型，并继续随主模型变化', () => {
    loadCatalog([chatModel('main'), chatModel('title-flash'), chatModel('other-main')]);
    setModelPurposeBinding('primary', 'main');
    setAuxiliaryModelPurposeBinding(TITLE, 'title-flash');

    setAuxiliaryModelPurposeBinding(TITLE, null);

    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('main');
    setModelPurposeBinding('primary', 'other-main');
    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('other-main');
  });

  it('所选标题模型被删除后回到跟随主模型', () => {
    loadCatalog([chatModel('main'), chatModel('title-flash')]);
    setModelPurposeBinding('primary', 'main');
    setAuxiliaryModelPurposeBinding(TITLE, 'title-flash');

    clearBindingsForModel('title-flash');
    loadCatalog([chatModel('main')]);

    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBe('main');
  });

  it('标题模型和主模型都不存在时没有有效模型，供调用方保持首问标题', () => {
    loadCatalog([]);

    expect(readEffectiveAuxiliaryModelPurposeBinding(TITLE)).toBeNull();
    expect(useModelPurposeBindings().effectiveAuxiliaryModelId(TITLE)).toBeNull();
  });
});
