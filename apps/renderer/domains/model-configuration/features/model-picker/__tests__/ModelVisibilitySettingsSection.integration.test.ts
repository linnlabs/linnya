// @vitest-environment jsdom

import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import type { ModelSourceRemovalResult } from '../../../definitions/modelSourceRemoval';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type {
  CustomApiProviderRefreshCommand,
  CustomApiProviderRefreshResponse,
} from '@app/schemas/custom-api-onboarding';
import type { ModelCatalogSnapshot } from '../../model-catalog';
import { useModelCatalogStore } from '../../model-catalog';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelPickerStore } from '../store/modelPickerStore';
import { setModelPickerModelVisibility } from '../orchestration/modelPickerOperations';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  removeCustomApiProviderModels:
    vi.fn<(name: string) => Promise<{ synchronizationFailed: boolean }>>(),
  removeModelSource:
    vi.fn<(modelConfigIds: readonly string[]) => Promise<ModelSourceRemovalResult>>(),
  refreshProviderModels: vi.fn<(id: string) => Promise<ModelPickerSnapshot>>(),
  setModelVisibility: vi.fn<() => Promise<ModelPickerSnapshot>>(),
  refreshCustomProvider:
    vi.fn<
      (command: CustomApiProviderRefreshCommand) => Promise<CustomApiProviderRefreshResponse>
    >(),
  loadPicker: vi.fn<() => Promise<ModelPickerSnapshot>>(),
  loadCatalog: vi.fn<() => Promise<ModelCatalogSnapshot>>(),
}));

vi.mock('../infrastructure/httpModelPickerGateway', () => ({
  httpModelPickerGateway: {
    refreshProviderModels: mocks.refreshProviderModels,
    setModelVisibility: mocks.setModelVisibility,
    load: mocks.loadPicker,
  },
}));

vi.mock(
  '../../custom-model-registration/infrastructure/httpCustomApiProviderRefreshGateway',
  () => ({
    httpCustomApiProviderRefreshGateway: { refreshProvider: mocks.refreshCustomProvider },
  })
);
vi.mock('../../model-catalog/infrastructure/httpModelCatalogGateway', () => ({
  httpModelCatalogGateway: { load: mocks.loadCatalog },
}));

vi.mock('@shared/composables/confirmDialog', () => ({
  confirm: mocks.confirm,
}));

vi.mock('../../../orchestration/removeCustomApiProviderModels', () => ({
  removeCustomApiProviderModels: mocks.removeCustomApiProviderModels,
}));

vi.mock('../../../orchestration/removeModelSource', () => ({
  removeModelSource: mocks.removeModelSource,
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

  function mountSection(): void {
    const pinia = getActivePinia();
    if (!pinia) throw new Error('Pinia instance missing');
    app = createApp(ModelVisibilitySettingsSection, {
      activateProviderModel: vi.fn(async () => undefined),
    });
    app.use(pinia);
    app.mount(host);
  }

  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.refreshCustomProvider.mockReset();
    mocks.loadPicker.mockReset();
    mocks.loadCatalog.mockReset();
    mocks.refreshProviderModels.mockReset();
    mocks.setModelVisibility.mockReset();
    mocks.removeCustomApiProviderModels.mockReset();
    mocks.removeCustomApiProviderModels.mockResolvedValue({ synchronizationFailed: false });
    mocks.removeModelSource.mockReset();
    mocks.removeModelSource.mockResolvedValue({
      removedModelIds: [],
      failure: null,
      synchronizationFailed: false,
    });

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
          credential_kind: 'api_key',
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
    mountSection();
  });

  it.each(['success', 'refresh-failed', 'catalog-read-failed', 'picker-read-failed'])(
    '自定义分组刷新 %s：区分远端提交失败与提交后的投影读取失败',
    async outcome => {
      const snapshot: ModelPickerSnapshot = {
        providers: [],
        custom_models: [],
        custom_providers: [
          {
            provider_id: 'custom:Relay',
            provider_name: 'Relay',
            api_format: 'openai_compatible',
            base_url: 'https://relay.example.com/v1',
            endpoint_id: 'relay-endpoint',
            models: [
              {
                materialized: true,
                model_config_id: 'existing',
                display_name: 'Existing',
                picker_enabled: false,
                runtime_available: true,
                capabilities: ['chat'],
                image_input: false,
              },
            ],
          },
        ],
      };
      useModelPickerStore().replaceSnapshot(snapshot);
      const refreshed: ModelPickerSnapshot = {
        ...snapshot,
        custom_providers: snapshot.custom_providers?.map(group => ({
          ...group,
          models: [
            ...group.models,
            {
              materialized: true,
              model_config_id: 'new-model',
              display_name: 'New Model',
              picker_enabled: false,
              runtime_available: true,
              capabilities: ['chat'],
              image_input: false,
            },
          ],
        })),
      };
      mocks.loadPicker.mockResolvedValue(refreshed);
      mocks.loadCatalog.mockResolvedValue({
        models: [
          {
            id: 'new-model',
            model_name: 'remote-new',
            display_name: 'New Model',
            catalog_source: 'user',
            capabilities: ['chat'],
            ui_visibility: [],
          },
        ],
        purposeDefaults: {},
        cloudModelsReady: true,
      });
      if (outcome !== 'refresh-failed') {
        mocks.refreshCustomProvider.mockResolvedValue({
          provider_name: 'Relay',
          added_model_ids: ['new-model'],
          removed_model_ids: [],
          model_picker_preference_recovery_pending: false,
        });
      } else {
        mocks.refreshCustomProvider.mockRejectedValue(new Error('已保存的 API Key 鉴权失败'));
      }
      if (outcome === 'catalog-read-failed') {
        mocks.loadCatalog.mockRejectedValue(new Error('catalog unavailable'));
      }
      if (outcome === 'picker-read-failed') {
        mocks.loadPicker.mockRejectedValue(new Error('picker unavailable'));
      }
      await flushUi();
      const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
      if (!button) throw new Error('自定义分组刷新入口缺失');
      expect(button.getAttribute('aria-label')).toBe('settings.modelPicker.synchronizeModels');
      button.click();
      await flushUi();
      expect(mocks.refreshCustomProvider).toHaveBeenCalledWith({ provider_name: 'Relay' });
      expect(mocks.refreshProviderModels).not.toHaveBeenCalled();
      if (outcome === 'success') {
        expect(mocks.loadCatalog).toHaveBeenCalledOnce();
        expect(mocks.loadPicker).toHaveBeenCalledOnce();
        expect(useModelCatalogStore().models.map(model => model.id)).toContain('new-model');
        expect(host.textContent).toContain('New Model');
        expect(
          Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every(
            input => !input.checked
          )
        ).toBe(true);
      } else if (outcome === 'refresh-failed') {
        expect(mocks.loadCatalog).not.toHaveBeenCalled();
        expect(mocks.loadPicker).not.toHaveBeenCalled();
        expect(useModelPickerStore().snapshot).toEqual(snapshot);
        expect(host.textContent).toContain('Relay: 已保存的 API Key 鉴权失败');
      } else {
        expect(mocks.loadCatalog).toHaveBeenCalledOnce();
        expect(mocks.loadPicker).toHaveBeenCalledOnce();
        expect(mocks.refreshCustomProvider).toHaveBeenCalledOnce();
        expect(host.textContent).toContain('settings.modelPicker.refreshedSyncFailed');
        expect(host.textContent).not.toContain('catalog unavailable');
        expect(host.textContent).not.toContain('picker unavailable');
      }
    }
  );

  it('Host 保留的空自定义分组仍可刷新，不因没有模型丢失管理入口', async () => {
    const emptyGroup: ModelPickerSnapshot = {
      providers: [],
      custom_models: [],
      custom_providers: [
        {
          provider_id: 'custom:Relay',
          provider_name: 'Relay',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
          endpoint_id: 'relay-endpoint',
          models: [],
        },
      ],
    };
    useModelPickerStore().replaceSnapshot(emptyGroup);
    mocks.refreshCustomProvider.mockResolvedValue({
      provider_name: 'Relay',
      added_model_ids: [],
      removed_model_ids: [],
      model_picker_preference_recovery_pending: false,
    });
    mocks.loadPicker.mockResolvedValue(emptyGroup);
    mocks.loadCatalog.mockResolvedValue({
      models: [],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    await flushUi();
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn');
    if (!button) throw new Error('空自定义分组刷新入口缺失');
    button.click();
    await flushUi();
    expect(mocks.refreshCustomProvider).toHaveBeenCalledExactlyOnceWith({ provider_name: 'Relay' });
    expect(host.querySelector('.model-visibility-refresh-btn')).not.toBeNull();
    expect(host.textContent).toContain('Relay');
  });

  it('最后一个空分组删除成功后读取失败，空态仍展示已提交删除的同步失败提示', async () => {
    const actual = await vi.importActual<
      typeof import('../../../orchestration/removeCustomApiProviderModels')
    >('../../../orchestration/removeCustomApiProviderModels');
    const removeProvider = vi.fn(async () => ({
      removed_model_ids: [],
      model_picker_preference_recovery_pending: false,
    }));
    mocks.removeCustomApiProviderModels.mockImplementation(providerName =>
      actual.removeCustomApiProviderModels(providerName, { removeProvider })
    );
    useModelPickerStore().replaceSnapshot({
      providers: [],
      custom_models: [],
      custom_providers: [
        {
          provider_id: 'custom:Relay',
          provider_name: 'Relay',
          api_format: 'openai_compatible',
          base_url: 'https://relay.example.com/v1',
          models: [],
        },
      ],
    });
    mocks.confirm.mockResolvedValue(true);
    mocks.loadCatalog.mockResolvedValue({
      models: [],
      purposeDefaults: {},
      cloudModelsReady: false,
    });
    mocks.loadPicker.mockRejectedValue(new Error('picker unavailable'));
    await flushUi();
    const button = host.querySelector<HTMLButtonElement>('.model-visibility-provider-delete');
    if (!button) throw new Error('空自定义分组删除入口缺失');
    button.click();
    await flushUi();

    expect(removeProvider).toHaveBeenCalledExactlyOnceWith({ provider_name: 'Relay' });
    expect(useModelPickerStore().snapshot?.custom_providers).toEqual([]);
    expect(host.querySelector('.model-visibility-source-tab')).toBeNull();
    expect(host.textContent).toContain('settings.modelPicker.empty');
    expect(host.textContent).toContain('settings.modelPicker.removedSyncFailed');
    expect(host.textContent).not.toContain('picker unavailable');
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
    expect(mocks.removeModelSource).not.toHaveBeenCalled();
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

  it('未接入在线查询的来源保留更新入口并明确说明原因', async () => {
    const current = useModelPickerStore().snapshot;
    if (!current) throw new Error('初始快照缺失');
    useModelPickerStore().replaceSnapshot({
      ...current,
      providers: current.providers.map(provider => ({ ...provider, can_refresh_models: false })),
    });
    await flushUi();
    expect(host.querySelector<HTMLButtonElement>('.model-visibility-refresh-btn')?.disabled).toBe(
      true
    );
    expect(host.textContent).toContain('settings.modelPicker.refreshUnavailable');
    expect(mocks.refreshProviderModels).not.toHaveBeenCalled();
  });

  it('管理页按导航指定的连接打开，而不是总选第一个供应商', async () => {
    const current = useModelPickerStore().snapshot;
    const first = current?.providers[0];
    if (!current || !first) throw new Error('初始快照缺失');
    app?.unmount();
    useModelPickerStore().replaceSnapshot({
      ...current,
      providers: [
        ...current.providers,
        {
          ...first,
          configured_provider_id: 'target',
          display_name: 'OpenCode Go',
        },
      ],
    });
    useModelPickerStore().selectManagementProvider('target');
    mountSection();
    await flushUi();
    expect(host.querySelector('.model-visibility-models-header h4')?.textContent).toContain(
      'OpenCode Go'
    );
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
    expect(mocks.removeModelSource).not.toHaveBeenCalled();

    mocks.confirm.mockResolvedValueOnce(true);
    deleteButton.click();
    await flushUi();
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      message: 'settings.modelPicker.removeProvider.confirm',
      isDangerousAction: true,
    });
    expect(mocks.removeModelSource).toHaveBeenCalledOnce();
    expect(mocks.removeModelSource).toHaveBeenCalledWith(['openai-gpt-test']);
  });
});
