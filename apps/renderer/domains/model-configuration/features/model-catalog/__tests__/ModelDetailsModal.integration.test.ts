// @vitest-environment jsdom

import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogItem } from '../definitions/modelCatalog';

const mocks = vi.hoisted(() => ({
  updateModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../orchestration/modelCatalogOperations', () => ({
  updateModelInCatalog: mocks.updateModel,
}));

vi.mock('../../../orchestration/deleteConfiguredModel', () => ({
  deleteConfiguredModel: vi.fn(),
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

import ModelDetailsModal from '../ui/ModelDetailsModal.vue';

function createModel(): ModelCatalogItem {
  return {
    id: 'custom-model',
    catalog_source: 'user',
    display_name: 'Custom model',
    model_name: 'provider-model',
    capabilities: ['chat'],
    inference_route: buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: 'openai-compatible',
      endpoint_model_id: 'provider-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    }),
  };
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function replaceInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ModelDetailsModal token capacity editing', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    mocks.updateModel.mockReset();
    mocks.updateModel.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    app = undefined;
  });

  it('显示当前 route 容量，并把用户编辑值提交到同一个模型更新流程', async () => {
    app = createApp(ModelDetailsModal, { show: true, model: createModel() });
    app.mount(host);
    await flushUi();

    const contextWindowInput = document.querySelector<HTMLInputElement>(
      '#model-context-window-tokens'
    );
    const maxOutputInput = document.querySelector<HTMLInputElement>('#model-max-output-tokens');
    expect(contextWindowInput?.value).toBe('32768');
    expect(maxOutputInput?.value).toBe('4096');

    if (!contextWindowInput || !maxOutputInput) throw new Error('模型容量输入框未渲染');
    replaceInputValue(contextWindowInput, '128000');
    replaceInputValue(maxOutputInput, '16384');
    await nextTick();

    const saveButton = document.querySelector<HTMLButtonElement>('.action-btn.primary');
    saveButton?.click();
    await flushUi();

    expect(mocks.updateModel).toHaveBeenCalledOnce();
    expect(mocks.updateModel).toHaveBeenCalledWith(
      'custom-model',
      expect.objectContaining({
        inference_route: expect.objectContaining({
          context_window_tokens: 128_000,
          max_output_tokens: 16_384,
        }),
      })
    );
  });

  it('把推理端点的地址与协议只读展示，不提供模型级旁路', async () => {
    app = createApp(ModelDetailsModal, { show: true, model: createModel() });
    app.mount(host);
    await flushUi();

    const infoTexts = Array.from(document.querySelectorAll('.info-text')).map(element =>
      element.textContent?.trim()
    );
    expect(infoTexts).toContain('https://example.com/v1');
    expect(infoTexts).toContain('settings.addModel.compatibility.openaiCompatible');
    expect(document.querySelector('.form-row .select-trigger')).toBeNull();
  });

  it('Chat-only 图片模型分别展示用户图片可用、工具结果图片不可用', async () => {
    const model = createModel();
    model.capabilities = ['chat', 'image_input'];
    if (!model.inference_route) throw new Error('测试模型必须包含推理 route');
    model.inference_route = {
      ...model.inference_route,
      input_support: { user_image: true, tool_result_image: false },
    };
    app = createApp(ModelDetailsModal, { show: true, model });
    app.mount(host);
    await flushUi();

    const infoTexts = Array.from(document.querySelectorAll('.info-text')).map(element =>
      element.textContent?.trim()
    );
    expect(infoTexts).toContain('settings.modelCapability.supported');
    expect(infoTexts).toContain('settings.modelCapability.unsupported');
    expect(document.querySelector<HTMLInputElement>('.toggle-switch input')?.checked).toBe(true);
  });
});
