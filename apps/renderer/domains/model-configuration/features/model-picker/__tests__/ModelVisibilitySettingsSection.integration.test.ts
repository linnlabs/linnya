// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelPickerStore } from '../store/modelPickerStore';
import { setModelPickerModelVisibility } from '../orchestration/modelPickerOperations';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  removeConfiguredProvider: vi.fn<(modelConfigIds: readonly string[]) => Promise<void>>(),
  refreshProviderModels: vi.fn<(id: string) => Promise<ModelPickerSnapshot>>(),
  setModelVisibility: vi.fn<() => Promise<ModelPickerSnapshot>>(),
}));

vi.mock('../infrastructure/httpModelPickerGateway', () => ({
  httpModelPickerGateway: {
    refreshProviderModels: mocks.refreshProviderModels,
    setModelVisibility: mocks.setModelVisibility,
  },
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
  // 等待来源刷新、网关读取和 Vue 更新这一整条 promise 链，不依赖固定微任务层数。
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
}

describe('ModelVisibilitySettingsSection Provider 操作', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.refreshProviderModels.mockReset();
    mocks.setModelVisibility.mockReset();
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
          can_refresh_models: true,
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

  it('刷新调用供应商发现入口并呈现新候选，保留已有配置', async () => {
    const current = useModelPickerStore().snapshot;
    if (!current) throw new Error('初始快照缺失');
    mocks.refreshProviderModels.mockResolvedValue({
      ...current,
      providers: current.providers.map(provider => ({
        ...provider,
        models: [
          ...provider.models,
          {
            materialized: false,
            provider_model_id: 'gpt-new',
            display_name: 'New Catalog Model',
            picker_enabled: false,
            runtime_available: false,
            capabilities: ['chat'],
            image_input: true,
          },
        ],
      })),
    });
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
    if (!button) throw new Error('重新加载入口缺失');
    expect(button.getAttribute('aria-label')).toBe('settings.modelPicker.refreshModels');
    button.click();
    await flushUi();
    expect(mocks.refreshProviderModels).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('New Catalog Model');
    expect(host.textContent).toContain('GPT Test');
    expect(mocks.removeConfiguredProvider).not.toHaveBeenCalled();
  });

  it('读取失败保留旧列表并展示错误，重试成功清除错误', async () => {
    const current = useModelPickerStore().snapshot;
    if (!current) throw new Error('初始快照缺失');
    mocks.refreshProviderModels
      .mockRejectedValueOnce(new Error('catalog read failed'))
      .mockResolvedValue(current);
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
    if (!button) throw new Error('重新加载入口缺失');
    button.click();
    await flushUi();
    expect(host.textContent).toContain('catalog read failed');
    expect(host.textContent).toContain('GPT Test');
    expect(button.disabled).toBe(false);
    button.click();
    await flushUi();
    expect(host.textContent).not.toContain('catalog read failed');
  });

  it('刷新错误不会遮住后续开关失败，操作成功后清除错误', async () => {
    const current = useModelPickerStore().snapshot;
    if (!current) throw new Error('初始快照缺失');
    mocks.refreshProviderModels.mockRejectedValue(new Error('catalog read failed'));
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
    if (!button) throw new Error('重新加载入口缺失');
    button.click();
    await flushUi();
    expect(host.textContent).toContain('catalog read failed');

    mocks.setModelVisibility
      .mockRejectedValueOnce(new Error('visibility save failed'))
      .mockResolvedValue(current);
    await expect(setModelPickerModelVisibility('openai-gpt-test', false)).rejects.toThrow(
      'visibility save failed'
    );
    await flushUi();
    expect(host.textContent).toContain('visibility save failed');
    expect(host.textContent).not.toContain('catalog read failed');
    await setModelPickerModelVisibility('openai-gpt-test', false);
    await flushUi();
    expect(host.textContent).not.toContain('visibility save failed');
  });

  it('切换来源后，延迟返回的刷新错误仍标明原供应商', async () => {
    const current = useModelPickerStore().snapshot;
    const first = current?.providers[0];
    if (!current || !first) throw new Error('初始快照缺失');
    useModelPickerStore().replaceSnapshot({
      ...current,
      providers: [
        ...current.providers,
        {
          ...first,
          configured_provider_id: 'configured-other',
          provider_definition_id: 'other',
          display_name: 'Other Provider',
          models: [],
        },
      ],
    });
    let rejectLoad: ((reason: Error) => void) | undefined;
    mocks.refreshProviderModels.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      })
    );
    await flushUi();
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
    if (!button) throw new Error('重新加载入口缺失');
    button.click();
    await flushUi();
    const other = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.model-visibility-source-tab')
    ).find(candidate => candidate.textContent?.includes('Other Provider'));
    if (!other || !rejectLoad) throw new Error('第二来源或读取请求缺失');
    other.click();
    rejectLoad(new Error('catalog read failed'));
    await flushUi();
    expect(host.textContent).toContain('OpenAI: catalog read failed');
    expect(host.querySelector('.model-visibility-models')?.textContent).not.toContain(
      'catalog read failed'
    );
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
