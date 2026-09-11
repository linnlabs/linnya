// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerOllama: vi.fn(),
  registerCustomApi: vi.fn(),
  discoverModels: vi.fn(),
  listModels: vi.fn(),
  loadModels: vi.fn(),
  loadModelPicker: vi.fn(),
  loadProviders: vi.fn(),
  getChatGptStatus: vi.fn(),
  authorizeChatGpt: vi.fn(),
  disconnectChatGpt: vi.fn(),
}));

vi.mock(
  '../features/ollama-model-registration/infrastructure/httpOllamaModelRegistrationGateway',
  () => ({
    httpOllamaModelRegistrationGateway: { register: mocks.registerOllama },
  })
);

vi.mock('../features/ollama-model-registration/infrastructure/ollamaModelDiscoveryPort', () => ({
  createOllamaModelDiscoveryPort: () => ({ listModels: mocks.listModels }),
}));

vi.mock(
  '../features/custom-model-registration/infrastructure/httpCustomApiModelRegistrationGateway',
  () => ({
    httpCustomApiModelRegistrationGateway: {
      register: mocks.registerCustomApi,
      discoverModels: (...args: unknown[]) => mocks.discoverModels(...args),
    },
  })
);

vi.mock('../features/model-catalog/infrastructure/httpModelCatalogGateway', () => ({
  httpModelCatalogGateway: {
    load: mocks.loadModels,
  },
}));

vi.mock('../features/provider-catalog/infrastructure/httpProviderCatalogGateway', () => ({
  httpProviderCatalogGateway: {
    load: mocks.loadProviders,
  },
}));

vi.mock('../features/model-picker/infrastructure/httpModelPickerGateway', () => ({
  httpModelPickerGateway: {
    load: mocks.loadModelPicker,
  },
}));

vi.mock(
  '../features/provider-account-model-registration/infrastructure/httpProviderAccountAuthorizationGateway',
  () => ({
    httpProviderAccountAuthorizationGateway: {
      getChatGptStatus: mocks.getChatGptStatus,
      authorizeChatGpt: mocks.authorizeChatGpt,
      disconnectChatGpt: mocks.disconnectChatGpt,
    },
  })
);

vi.mock('@/domains/settings/public', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domains/settings/public')>();
  return {
    ...actual,
    useSettingsLocalization: () => ({
      settingsMessage: (key: string) => key,
    }),
  };
});

import ModelRegistrationSettingsPage from '../ui/ModelRegistrationSettingsPage.vue';

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function inputValues(section: Element): string[] {
  return Array.from(section.querySelectorAll('input')).map(input => input.value);
}

function providerTrigger(container: Element): HTMLButtonElement {
  const providerRow = Array.from(container.querySelectorAll('.settings-row')).find(row =>
    row.textContent?.includes('settings.addModel.provider.label')
  );
  const trigger = providerRow?.querySelector<HTMLButtonElement>('.select-trigger');
  if (!trigger) throw new Error('Provider selector trigger not found');
  return trigger;
}

function quickOption(container: Element, optionText: string): HTMLButtonElement {
  const option = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.model-registration-quick-option')
  ).find(candidate => candidate.textContent?.trim() === optionText);
  if (!option) throw new Error(`Quick provider option not found: ${optionText}`);
  return option;
}

async function selectQuickOption(container: Element, optionText: string): Promise<void> {
  quickOption(container, optionText).click();
  await flushUi();
}

async function selectOtherProvider(container: Element, optionText: string): Promise<void> {
  quickOption(container, 'settings.addModel.quick.other').click();
  await nextTick();

  const option = Array.from(document.querySelectorAll<HTMLButtonElement>('.select-option')).find(
    candidate => candidate.textContent?.trim() === optionText
  );
  if (!option) throw new Error(`Other provider option not found: ${optionText}`);
  option.click();
  await flushUi();
}

function setInputValue(container: Element, placeholder: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function selectProvider(container: Element, optionText: string): Promise<void> {
  providerTrigger(container).click();
  await nextTick();
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>('.select-option')).find(
    candidate => candidate.textContent?.trim() === optionText
  );
  if (!option) throw new Error(`Provider option not found: ${optionText}`);
  option.click();
  await flushUi();
}

async function selectConnection(container: Element, optionText: string): Promise<void> {
  const connectionRow = Array.from(container.querySelectorAll('.settings-row')).find(row =>
    row.textContent?.includes('settings.addModel.connection.label')
  );
  const option = Array.from(
    connectionRow?.querySelectorAll<HTMLLabelElement>('.radio-item') ?? []
  ).find(candidate => candidate.textContent?.trim() === optionText);
  if (!option) throw new Error(`Connection option not found: ${optionText}`);
  option.click();
  await flushUi();
}

describe('ModelRegistrationSettingsPage', () => {
  let app: App<Element> | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.registerOllama.mockReset();
    mocks.registerCustomApi.mockReset();
    mocks.listModels.mockReset();
    mocks.loadModels.mockReset();
    mocks.loadModelPicker.mockReset();
    mocks.loadProviders.mockReset();
    mocks.getChatGptStatus.mockReset();
    mocks.authorizeChatGpt.mockReset();
    mocks.disconnectChatGpt.mockReset();
    mocks.registerCustomApi.mockResolvedValue({ model_id: 'custom-model' });
    mocks.registerOllama.mockResolvedValue({
      model_id: 'ollama-model',
      provider_definition_id: 'ollama',
      provider_connection_definition_id: 'ollama',
      provider_model_id: 'qwen3:8b',
    });
    mocks.listModels.mockResolvedValue(['qwen3:8b']);
    mocks.getChatGptStatus.mockResolvedValue({
      account_id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      status: 'disconnected',
    });
    mocks.authorizeChatGpt.mockResolvedValue({
      account_id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      status: 'connected',
    });
    mocks.disconnectChatGpt.mockResolvedValue({
      account_id: 'chatgpt-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      status: 'disconnected',
    });
    mocks.loadModels.mockResolvedValue({
      models: [],
      purposeDefaults: {},
      cloudModelsReady: true,
    });
    mocks.loadModelPicker.mockResolvedValue({ providers: [], custom_models: [] });
    mocks.loadProviders.mockResolvedValue({
      generation: {
        id: 'test-generation',
        source_url: 'https://models.dev/api.json',
        source_sha256: 'a'.repeat(64),
        synced_at: '2026-08-20T00:00:00.000Z',
        policy_version: 1,
      },
      providers: [
        {
          id: 'openai',
          display_name: 'OpenAI',
          connections: [
            {
              id: 'openai-api',
              display_name: 'OpenAI API',
              kind: 'direct',
              release_status: 'stable',
              setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
              model_discovery: 'bundled',
              models: [
                {
                  id: 'gpt-test',
                  display_name: 'GPT Test',
                  release_status: 'active',
                  context_window_tokens: 256000,
                  max_input_tokens: 240000,
                  max_output_tokens: 16384,
                  capabilities: { image_input: true, tool_call: true, reasoning: true },
                },
              ],
            },
            {
              id: 'openai-chatgpt-subscription',
              display_name: 'ChatGPT 订阅',
              kind: 'direct',
              release_status: 'preview',
              setup_fields: [
                {
                  id: 'authorization',
                  kind: 'oauth',
                  required: true,
                  label: '使用 ChatGPT 登录',
                },
              ],
              model_discovery: 'account_catalog',
              models: [],
            },
          ],
        },
        {
          id: 'anthropic',
          display_name: 'Anthropic',
          connections: [
            {
              id: 'anthropic',
              display_name: 'Anthropic',
              kind: 'direct',
              release_status: 'stable',
              setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
              model_discovery: 'bundled',
              models: [
                {
                  id: 'claude-sonnet',
                  display_name: 'Claude Sonnet',
                  release_status: 'active',
                  context_window_tokens: 200000,
                  max_input_tokens: 180000,
                  max_output_tokens: 8192,
                  capabilities: { image_input: true, tool_call: true, reasoning: true },
                },
              ],
            },
          ],
        },
        {
          id: 'deepseek',
          display_name: 'DeepSeek',
          connections: [
            {
              id: 'deepseek',
              display_name: 'DeepSeek',
              setup_help_url: 'https://platform.deepseek.com/api_keys',
              kind: 'direct',
              release_status: 'stable',
              setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
              model_discovery: 'bundled',
              models: [
                {
                  id: 'deepseek-chat',
                  display_name: 'DeepSeek Chat',
                  release_status: 'active',
                  context_window_tokens: 128000,
                  max_input_tokens: 120000,
                  max_output_tokens: 8192,
                  capabilities: { image_input: false, tool_call: true, reasoning: false },
                },
              ],
            },
          ],
        },
        {
          id: 'ollama',
          display_name: 'Ollama',
          connections: [
            {
              id: 'ollama',
              display_name: 'Ollama 本地',
              kind: 'local_runtime',
              release_status: 'preview',
              setup_fields: [
                {
                  id: 'service_url',
                  kind: 'url',
                  required: true,
                  label: '服务地址',
                  default_value: 'http://127.0.0.1:11434',
                },
              ],
              model_discovery: 'local_runtime',
              models: [],
            },
            {
              id: 'ollama-cloud',
              display_name: 'Ollama Cloud',
              setup_help_url: 'https://ollama.com/settings/keys',
              kind: 'direct',
              release_status: 'preview',
              setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
              model_discovery: 'bundled',
              models: [
                {
                  id: 'glm-5.3',
                  display_name: 'GLM-5.3',
                  release_status: 'active',
                  context_window_tokens: 1_000_000,
                  max_input_tokens: 934_464,
                  max_output_tokens: 65_536,
                  capabilities: { image_input: true, tool_call: true, reasoning: true },
                },
              ],
            },
          ],
        },
      ],
      total: 4,
    });
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    app = undefined;
  });

  it('首屏展示常用 Provider、其他供应商和自定义 API 入口', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    const sections = container.querySelectorAll('.settings-section');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.textContent).toContain('settings.addModel.quick.title');
    expect(sections[0]?.textContent).toContain('OpenAI');
    expect(sections[0]?.textContent).toContain('Claude');
    expect(sections[0]?.textContent).toContain('Ollama Cloud');
    expect(sections[0]?.textContent).toContain('settings.addModel.quick.other');
    expect(sections[0]?.textContent).toContain('settings.addModel.quick.customApi');
    expect(container.querySelector('.settings-row .select-trigger')).toBeNull();
    expect(container.querySelector('[data-registration-kind="custom-provider"]')).toBeNull();
    expect(container.querySelector('[data-registration-kind="direct-provider"]')).toBeNull();
    expect(container.querySelector('[data-registration-kind="ollama"]')).toBeNull();
    expect(mocks.listModels).not.toHaveBeenCalled();
  });

  it('Provider 选择统一来自自定义入口和公开目录，内部 endpoint 不进入选项', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectQuickOption(container, 'settings.addModel.quick.customApi');
    providerTrigger(container).click();
    await nextTick();

    const providerOptionTexts = Array.from(document.querySelectorAll('.select-option')).map(
      option => option.textContent?.trim()
    );
    expect(providerOptionTexts).toEqual([
      'settings.addModel.provider.customOption',
      'OpenAI',
      'Anthropic',
      'DeepSeek',
      'Ollama',
    ]);
    expect(document.body.textContent).not.toContain('xiaoxiao.work.gd');
  });

  it('其他供应商选择后进入相同的 Provider 接入详情', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectOtherProvider(container, 'DeepSeek');

    expect(providerTrigger(container).textContent).toContain('DeepSeek');
    expect(container.querySelector('[data-registration-kind="direct-provider"]')).not.toBeNull();
    expect(container.querySelector('.model-registration-quick-options')).toBeNull();
    expect(container.querySelector('.settings-external-link-icon')).not.toBeNull();
  });

  it('账号型 Provider 授权后自动刷新模型管理，不再要求手动添加模型', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectQuickOption(container, 'OpenAI');
    await selectConnection(container, 'ChatGPT 订阅');

    const accountForm = container.querySelector('[data-registration-kind="provider-account"]');
    if (!accountForm) throw new Error('Provider account form not found');
    expect(accountForm.querySelector('input')).toBeNull();
    expect(accountForm.textContent).not.toContain('settings.addModel.apiKey.label');
    expect(accountForm.textContent).not.toContain('Responses');
    expect(mocks.getChatGptStatus).toHaveBeenCalledOnce();

    const connectButton = accountForm.querySelector<HTMLButtonElement>('.action-btn.primary');
    if (!connectButton) throw new Error('ChatGPT sign-in button not found');
    connectButton.click();
    await flushUi();

    expect(mocks.authorizeChatGpt).toHaveBeenCalledOnce();
    expect(accountForm.textContent).toContain('settings.addModel.account.connected');
    expect(accountForm.textContent).not.toContain('settings.addModel.modelName.label');
    expect(mocks.loadModels).toHaveBeenCalledOnce();
    expect(mocks.loadModelPicker).toHaveBeenCalledOnce();
  });

  it('切换 Provider 时只显示对应字段，并使用各自的容量来源', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectQuickOption(container, 'OpenAI');
    await selectConnection(container, 'OpenAI API');

    const section = container.querySelector('.settings-section');
    if (!section) throw new Error('Provider settings section not found');
    expect(container.querySelector('[data-registration-kind="custom-provider"]')).toBeNull();
    expect(container.querySelector('[data-registration-kind="direct-provider"]')).not.toBeNull();
    expect(inputValues(section)).not.toContain('256000');
    expect(inputValues(section)).not.toContain('16384');
    expect(section.textContent).not.toContain('settings.addModel.compatibility.label');

    await selectProvider(container, 'Ollama');
    await selectConnection(container, 'Ollama 本地');

    expect(container.querySelector('[data-registration-kind="direct-provider"]')).toBeNull();
    expect(container.querySelector('[data-registration-kind="ollama"]')).not.toBeNull();
    expect(inputValues(section)).toContain('32768');
    expect(inputValues(section)).toContain('4096');
    expect(inputValues(section)).not.toContain('256000');
    expect(inputValues(section)).not.toContain('16384');
    expect(mocks.listModels).toHaveBeenCalledWith('http://localhost:11434');

    await selectConnection(container, 'Ollama Cloud');

    expect(container.querySelector('[data-registration-kind="ollama"]')).toBeNull();
    expect(container.querySelector('[data-registration-kind="direct-provider"]')).not.toBeNull();
    expect(container.querySelector('.settings-external-link-icon')).not.toBeNull();
    expect(section.textContent).toContain('settings.addModel.apiKey.label');
    expect(inputValues(section)).not.toContain('32768');
    expect(inputValues(section)).not.toContain('4096');
  });

  it('自定义 Provider 内部仍单独选择兼容格式', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectQuickOption(container, 'settings.addModel.quick.customApi');

    const compatibilityRow = Array.from(container.querySelectorAll('.settings-row')).find(row =>
      row.textContent?.includes('settings.addModel.compatibility.label')
    );
    const trigger = compatibilityRow?.querySelector<HTMLButtonElement>('.select-trigger');
    expect(trigger?.textContent).toContain('settings.addModel.compatibility.openaiCompatible');

    trigger?.click();
    await nextTick();

    const optionTexts = Array.from(document.querySelectorAll('.select-option'))
      .map(option => option.textContent?.trim())
      .filter(text => text?.startsWith('settings.addModel.compatibility.'));
    expect(optionTexts).toEqual([
      'settings.addModel.compatibility.openaiCompatible',
      'settings.addModel.compatibility.openaiResponses',
      'settings.addModel.compatibility.anthropicCompatible',
    ]);
  });

  it('自定义 Provider 探测并注册成功后只刷新模型事实源', async () => {
    app = createApp(ModelRegistrationSettingsPage);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    await selectQuickOption(container, 'settings.addModel.quick.customApi');

    const urlInput = container.querySelector<HTMLInputElement>(
      `input[placeholder="settings.addModel.apiUrl.placeholder"]`
    );
    if (!urlInput) throw new Error('URL input not found');
    urlInput.value = 'http://gateway.intranet/v1';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushUi();

    mocks.discoverModels.mockResolvedValue({
      models: [
        {
          id: 'gpt-test',
          name: 'GPT Test',
          context_window_tokens: 128000,
          max_output_tokens: 4096,
          supports_image_input: false,
        },
      ],
    });

    const discoverButton = container.querySelector<HTMLButtonElement>(
      '[data-registration-kind="custom-provider"] .add-model-discover-button'
    );
    if (!discoverButton) throw new Error('Custom Provider discover button not found');
    discoverButton.click();
    await flushUi();

    await vi.waitFor(() => {
      expect(mocks.discoverModels).toHaveBeenCalled();
    });
    await flushUi();

    const submitButton = container.querySelector<HTMLButtonElement>(
      '[data-registration-kind="custom-provider"] .full-width-button'
    );
    if (!submitButton) throw new Error('Custom Provider submit button not found');
    submitButton.click();

    await vi.waitFor(() => {
      expect(mocks.loadModels).toHaveBeenCalledOnce();
    });
    expect(mocks.registerCustomApi).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: 'http://gateway.intranet/v1',
        models: expect.arrayContaining([
          expect.objectContaining({
            endpoint_model_id: 'gpt-test',
          }),
        ]),
      })
    );
  });
});
