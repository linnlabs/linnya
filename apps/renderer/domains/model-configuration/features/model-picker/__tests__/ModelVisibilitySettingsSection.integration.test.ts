// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelPickerStore } from '../store/modelPickerStore';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  removeConfiguredProvider: vi.fn<(modelConfigIds: readonly string[]) => Promise<void>>(),
}));

vi.mock('@shared/composables/confirmDialog', () => ({
  confirm: mocks.confirm,
}));

vi.mock('../../../orchestration/removeConfiguredProvider', () => ({
  removeConfiguredProvider: mocks.removeConfiguredProvider,
}));

vi.mock('@/domains/settings/public', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domains/settings/public')>();
  return {
    ...actual,
    useSettingsLocalization: () => ({
      settingsMessage: (key: string) => key,
    }),
  };
});

import ModelVisibilitySettingsSection from '../ui/ModelVisibilitySettingsSection.vue';

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe('ModelVisibilitySettingsSection Provider 删除', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.removeConfiguredProvider.mockReset();
    mocks.removeConfiguredProvider.mockResolvedValue(undefined);

    const pinia = createPinia();
    setActivePinia(pinia);
    useModelPickerStore().replaceSnapshot({
      providers: [
        {
          configured_provider_id: 'configured-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          display_name: 'OpenAI',
          connection_display_name: 'OpenAI API',
          kind: 'direct',
          picker_enabled: true,
          credential_available: true,
          models: [
            {
              materialized: true,
              model_config_id: 'openai-gpt-test',
              provider_model_id: 'gpt-test',
              display_name: 'GPT Test',
              picker_enabled: true,
              runtime_available: true,
              capabilities: ['chat'],
              image_input: false,
            },
          ],
        },
      ],
      custom_models: [],
    });

    host = document.createElement('div');
    document.body.append(host);
    app = createApp(ModelVisibilitySettingsSection, {
      activateProviderModel: vi.fn(async () => undefined),
    });
    app.use(pinia);
    app.mount(host);
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    app = undefined;
  });

  it('在启用开关左侧提供删除按钮，并仅在确认后删除 Provider', async () => {
    await flushUi();

    const actions = host.querySelector('.model-visibility-provider-actions');
    const deleteButton = actions?.querySelector<HTMLButtonElement>(
      '.model-visibility-provider-delete'
    );
    const switchControl = actions?.querySelector('.switch-control');
    if (!actions || !deleteButton || !switchControl) {
      throw new Error('Provider 操作区未渲染');
    }
    expect(deleteButton.nextElementSibling).toBe(switchControl);
    expect(deleteButton.getAttribute('aria-label')).toBe('settings.modelPicker.removeProvider');

    mocks.confirm.mockResolvedValueOnce(false);
    deleteButton.click();
    await flushUi();
    expect(mocks.removeConfiguredProvider).not.toHaveBeenCalled();

    mocks.confirm.mockResolvedValueOnce(true);
    deleteButton.click();
    await flushUi();
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      message: 'settings.modelPicker.removeProvider.confirm',
      isDangerousAction: true,
    });
    expect(mocks.removeConfiguredProvider).toHaveBeenCalledOnce();
    expect(mocks.removeConfiguredProvider).toHaveBeenCalledWith(['openai-gpt-test']);
  });
});
