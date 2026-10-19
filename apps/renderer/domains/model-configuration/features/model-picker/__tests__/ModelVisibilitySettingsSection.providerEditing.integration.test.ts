// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import type { ModelSourceRemovalResult } from '../../../definitions/modelSourceRemoval';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type { CustomApiProviderUpdateRequest } from '@app/schemas/custom-api-onboarding';
import type { DirectProviderCredentialReplacementCommand } from '@app/schemas/provider-onboarding';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelPickerStore } from '../store/modelPickerStore';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  removeCustomApiProviderModels:
    vi.fn<(name: string) => Promise<{ synchronizationFailed: boolean }>>(),
  removeModelSource:
    vi.fn<(modelConfigIds: readonly string[]) => Promise<ModelSourceRemovalResult>>(),
  refreshModelCatalog: vi.fn<() => Promise<void>>(),
  loadModelPicker: vi.fn<() => Promise<ModelPickerSnapshot>>(),
  updateProvider: vi.fn<(request: CustomApiProviderUpdateRequest) => Promise<unknown>>(),
  replaceCredential:
    vi.fn<(command: DirectProviderCredentialReplacementCommand) => Promise<void>>(),
}));

vi.mock('../infrastructure/httpModelPickerGateway', () => ({
  httpModelPickerGateway: { load: mocks.loadModelPicker },
}));

vi.mock('../../custom-model-registration/infrastructure/httpCustomApiProviderEditGateway', () => ({
  httpCustomApiProviderEditGateway: { updateProvider: mocks.updateProvider },
}));

vi.mock(
  '../../direct-provider-onboarding/infrastructure/httpDirectProviderCredentialGateway',
  () => ({
    httpDirectProviderCredentialGateway: { replaceCredential: mocks.replaceCredential },
  })
);

vi.mock('@shared/composables/confirmDialog', () => ({
  confirm: mocks.confirm,
}));

vi.mock('../../../orchestration/removeCustomApiProviderModels', () => ({
  removeCustomApiProviderModels: mocks.removeCustomApiProviderModels,
}));

vi.mock('../../../orchestration/removeModelSource', () => ({
  removeModelSource: mocks.removeModelSource,
}));

vi.mock('../../../orchestration/refreshModelCatalogAfterRegistration', () => ({
  refreshModelCatalogAfterRegistration: mocks.refreshModelCatalog,
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

function materializedModel(id: string) {
  return {
    materialized: true as const,
    model_config_id: id,
    provider_model_id: id,
    display_name: id,
    picker_enabled: true,
    runtime_available: true,
    capabilities: ['chat'],
    image_input: false,
  };
}

function snapshot(overrides: { readonly credentialAvailable?: boolean } = {}): ModelPickerSnapshot {
  return {
    providers: [
      {
        configured_provider_id: 'configured-openai',
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
        display_name: 'OpenAI',
        connection_display_name: 'OpenAI API',
        can_refresh_models: false,
        kind: 'direct',
        credential_kind: 'api_key',
        picker_enabled: true,
        credential_available: overrides.credentialAvailable ?? true,
        ...(overrides.credentialAvailable === false
          ? { credential_unavailable_reason: 'invalidated' as const }
          : {}),
        models: [materializedModel('openai-gpt')],
      },
      {
        configured_provider_id: 'configured-chatgpt',
        provider_definition_id: 'chatgpt',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
        display_name: 'ChatGPT',
        connection_display_name: 'ChatGPT 订阅',
        can_refresh_models: false,
        kind: 'direct',
        credential_kind: 'provider_account',
        picker_enabled: true,
        credential_available: true,
        models: [materializedModel('chatgpt-sol')],
      },
    ],
    custom_models: [materializedModel('relay-a'), materializedModel('relay-b')],
    custom_providers: [
      {
        provider_id: 'custom:Relay',
        provider_name: 'Relay',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        endpoint_id: 'relay-endpoint',
        models: [materializedModel('relay-a'), materializedModel('relay-b')],
      },
    ],
  };
}

async function flushUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
}

function typeInto(input: HTMLInputElement | undefined, value: string): void {
  if (!input) throw new Error('输入框缺失');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ModelVisibilitySettingsSection 供应商编辑与删除', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  function mount(initial: ModelPickerSnapshot): void {
    const pinia = createPinia();
    setActivePinia(pinia);
    useModelPickerStore().replaceSnapshot(initial);
    mocks.loadModelPicker.mockResolvedValue(initial);
    host = document.createElement('div');
    document.body.append(host);
    app = createApp(ModelVisibilitySettingsSection, {
      activateProviderModel: vi.fn(async () => undefined),
    });
    app.use(pinia);
    app.mount(host);
  }

  async function selectSource(displayName: string): Promise<void> {
    const tab = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.model-visibility-source-tab')
    ).find(candidate => candidate.textContent?.trim() === displayName);
    if (!tab) throw new Error(`来源 ${displayName} 未渲染`);
    tab.click();
    await flushUi();
  }

  function headerButton(className: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`.model-visibility-models-header .${className}`);
  }

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.removeModelSource.mockResolvedValue({
      removedModelIds: [],
      failure: null,
      synchronizationFailed: false,
    });
    mocks.removeCustomApiProviderModels.mockResolvedValue({ synchronizationFailed: false });
    mocks.refreshModelCatalog.mockResolvedValue(undefined);
    mocks.replaceCredential.mockResolvedValue(undefined);
    mocks.updateProvider.mockResolvedValue({ provider_name: 'Relay', model_ids: ['relay-a'] });
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    app = undefined;
  });

  it('只有 API Key 接入的正式供应商提供更新 Key 入口', async () => {
    mount(snapshot());
    await flushUi();
    expect(headerButton('model-visibility-provider-edit')?.getAttribute('aria-label')).toBe(
      'settings.modelPicker.replaceApiKey'
    );

    await selectSource('ChatGPT');
    expect(headerButton('model-visibility-provider-edit')).toBeNull();
    expect(headerButton('model-visibility-provider-delete')).not.toBeNull();
  });

  it('更新 Key 只提交连接身份和新 Key，成功后重读选择投影', async () => {
    mount(snapshot());
    await flushUi();
    headerButton('model-visibility-provider-edit')?.click();
    await flushUi();

    const content = document.querySelector('.direct-provider-credential-content');
    typeInto(content?.querySelector<HTMLInputElement>('input') ?? undefined, '  rotated-key  ');
    await nextTick();
    document
      .querySelector<HTMLButtonElement>('.direct-provider-credential-footer .linnya-ui-button--primary')
      ?.click();
    await flushUi();

    expect(mocks.replaceCredential).toHaveBeenCalledWith({
      provider_connection_definition_id: 'openai-api',
      api_key: 'rotated-key',
    });
    expect(mocks.loadModelPicker).toHaveBeenCalled();
    expect(document.querySelector('.direct-provider-credential-content')).toBeNull();
  });

  it('凭据失效时把更新 Key 作为首选恢复操作，同时保留删除', async () => {
    mount(snapshot({ credentialAvailable: false }));
    await flushUi();
    const actions = host.querySelector('.model-visibility-credential-actions');
    expect(actions?.querySelector('.linnya-ui-button--primary')?.textContent?.trim()).toBe(
      'settings.modelPicker.replaceApiKey'
    );
    expect(actions?.textContent).toContain('settings.modelPicker.removeProvider');
  });

  it('自定义供应商删除需确认，并删除该分组全部模型', async () => {
    mount(snapshot());
    await flushUi();
    await selectSource('Relay');

    mocks.confirm.mockResolvedValueOnce(false);
    headerButton('model-visibility-provider-delete')?.click();
    await flushUi();
    expect(mocks.removeModelSource).not.toHaveBeenCalled();

    mocks.confirm.mockResolvedValueOnce(true);
    headerButton('model-visibility-provider-delete')?.click();
    await flushUi();
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      message: 'settings.modelPicker.removeCustomProvider.confirm',
      isDangerousAction: true,
    });
    expect(mocks.removeCustomApiProviderModels).toHaveBeenCalledWith('Relay');
  });

  it('自定义供应商编辑预填当前连接，提交后重读模型目录', async () => {
    mount(snapshot());
    await flushUi();
    await selectSource('Relay');
    headerButton('model-visibility-provider-edit')?.click();
    await flushUi();

    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('.provider-connection-edit-content input')
    );
    expect(inputs.map(input => input.value)).toEqual(
      expect.arrayContaining(['Relay', 'https://relay.example.com/v1'])
    );
    const [nameInput, urlInput] = inputs.filter(input => input.type !== 'password');
    typeInto(nameInput, 'Relay Prod');
    typeInto(urlInput, 'https://relay-2.example.com');
    await nextTick();
    document
      .querySelector<HTMLButtonElement>('.provider-connection-edit-footer .linnya-ui-button--primary')
      ?.click();
    await flushUi();

    expect(mocks.updateProvider).toHaveBeenCalledWith({
      current_provider_name: 'Relay',
      provider_name: 'Relay Prod',
      api_format: 'openai_compatible',
      base_url: 'https://relay-2.example.com/v1',
    });
    expect(mocks.refreshModelCatalog).toHaveBeenCalledOnce();
    expect(document.querySelector('.provider-connection-edit-content')).toBeNull();
  });

  it('自定义供应商编辑失败时保留弹窗并展示 Host 错误', async () => {
    const { CustomApiModelRegistrationError } = await import('../../custom-model-registration');
    mocks.updateProvider.mockRejectedValueOnce(
      new CustomApiModelRegistrationError(
        'custom_api_onboarding.credential_required',
        '修改该分组的 API 地址或格式需要重新填写 API Key'
      )
    );
    mount(snapshot());
    await flushUi();
    await selectSource('Relay');
    headerButton('model-visibility-provider-edit')?.click();
    await flushUi();
    document
      .querySelector<HTMLButtonElement>('.provider-connection-edit-footer .linnya-ui-button--primary')
      ?.click();
    await flushUi();

    expect(document.querySelector('.provider-connection-edit-content')?.textContent).toContain(
      '需要重新填写 API Key'
    );
    expect(mocks.refreshModelCatalog).not.toHaveBeenCalled();
  });
});
