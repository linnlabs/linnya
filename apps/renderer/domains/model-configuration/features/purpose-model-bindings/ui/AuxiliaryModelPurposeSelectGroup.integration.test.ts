// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { ModelPickerMaterializedModel } from '@app/schemas/model-picker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_MESSAGE_CATALOG } from '@/domains/settings/definitions/settingsMessageCatalog';
import { useModelCatalogStore, type ModelCatalogItem } from '../../model-catalog';
import { useModelPickerStore } from '../../model-picker/store/modelPickerStore';
import { findAuxiliaryModelPurposeDefinition } from '../definitions/modelPurposes';
import { setModelPurposeBinding } from '../orchestration/modelPurposeBindings';
import { useModelPurposeBindingsStore } from '../store/modelPurposeBindingsStore';
import AuxiliaryModelPurposeSelectGroup from './AuxiliaryModelPurposeSelectGroup.vue';

const localeState = vi.hoisted(() => ({ locale: 'zh-CN' as 'zh-CN' | 'en-US' }));

vi.mock('@/domains/settings/public', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domains/settings/public')>();
  const { SETTINGS_MESSAGE_CATALOG: catalog } = await import(
    '@/domains/settings/definitions/settingsMessageCatalog'
  );
  return {
    ...actual,
    useSettingsLocalization: () => ({
      settingsMessage: (key: string) =>
        (catalog.catalogs[localeState.locale] as Record<string, string>)[key] ?? key,
    }),
  };
});

function catalogModel(id: string): ModelCatalogItem {
  return { id, catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] };
}

function pickerModel(id: string, displayName: string): ModelPickerMaterializedModel {
  return {
    materialized: true,
    model_config_id: id,
    provider_model_id: id,
    display_name: displayName,
    picker_enabled: true,
    runtime_available: true,
    capabilities: ['chat'],
    image_input: false,
  };
}

describe('对话标题模型选择（设置页）', () => {
  let app: App<Element> | undefined;
  let container: HTMLDivElement;
  let pinia: ReturnType<typeof createPinia>;

  function mountTitleSelect(): void {
    const purpose = findAuxiliaryModelPurposeDefinition('conversation_title');
    if (!purpose) throw new Error('对话标题用途未注册');
    app = createApp(AuxiliaryModelPurposeSelectGroup, {
      purposes: [purpose],
      idPrefix: 'titleSelect',
    });
    app.use(pinia);
    app.mount(container);
  }

  function triggerText(): string {
    return container.querySelector('.selected-value')?.textContent?.trim() ?? '';
  }

  async function chooseOption(text: string): Promise<void> {
    container.querySelector<HTMLButtonElement>('.select-trigger')?.click();
    await nextTick();
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('.select-option'))
      .find(candidate => candidate.textContent?.trim() === text);
    if (!option) throw new Error(`未找到选项：${text}`);
    option.click();
    await nextTick();
  }

  beforeEach(() => {
    localeState.locale = 'zh-CN';
    pinia = createPinia();
    setActivePinia(pinia);
    container = document.createElement('div');
    document.body.append(container);

    useModelCatalogStore().replaceSnapshot({
      models: [catalogModel('main'), catalogModel('title-flash')],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    useModelPickerStore().replaceSnapshot({
      providers: [],
      custom_models: [pickerModel('main', 'Main Model'), pickerModel('title-flash', 'Flash Model')],
    });
    setModelPurposeBinding('primary', 'main');
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    document.body.innerHTML = '';
    app = undefined;
  });

  it('未选择标题模型时明确显示跟随主模型，且不写入模型 ID', () => {
    mountTitleSelect();

    expect(triggerText()).toBe('使用主模型');
    expect(useModelPurposeBindingsStore().auxiliaryModelIds).toEqual({});
  });

  it('选择具体模型后显示该模型，并可以再切回跟随主模型', async () => {
    mountTitleSelect();

    await chooseOption('Flash Model');
    expect(useModelPurposeBindingsStore().auxiliaryModelIds.conversation_title).toBe('title-flash');
    expect(triggerText()).toBe('Flash Model');

    await chooseOption('使用主模型');
    expect(useModelPurposeBindingsStore().auxiliaryModelIds.conversation_title).toBeNull();
    expect(triggerText()).toBe('使用主模型');
  });

  it('英文界面同样提供跟随主模型选项和说明', () => {
    localeState.locale = 'en-US';
    mountTitleSelect();

    expect(triggerText()).toBe('Use primary model');
    expect(container.textContent).toContain('follows the current primary model');
  });

  it('每种界面语言都为对话标题声明了跟随主模型的说明', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const catalog = SETTINGS_MESSAGE_CATALOG.catalogs[locale] as Record<string, string>;
      expect(catalog['settings.modelConfig.auxiliary.purposes.conversationTitle.description'])
        .toContain(catalog['settings.modelConfig.auxiliary.default.primaryModel']);
    }
  });
});
