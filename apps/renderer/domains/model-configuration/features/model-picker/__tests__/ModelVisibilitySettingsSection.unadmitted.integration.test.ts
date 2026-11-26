// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import type {
  ModelSourceRemovalResult,
  ModelSourceRemovalTargets,
} from '../../../definitions/modelSourceRemoval';
import type { ModelPickerSnapshot, ModelPickerUnadmittedModel } from '@app/schemas/model-picker';
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelPickerStore } from '../store/modelPickerStore';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<(options: unknown) => Promise<boolean>>(),
  removeModelSource:
    vi.fn<(targets: ModelSourceRemovalTargets) => Promise<ModelSourceRemovalResult>>(),
  refreshProviderModels: vi.fn<(id: string) => Promise<ModelPickerSnapshot>>(),
  readRemovalImpact: vi.fn<(id: string) => Promise<{ scheduledTaskCount: number }>>(),
}));

vi.mock('../infrastructure/httpModelPickerGateway', () => ({
  httpModelPickerGateway: { refreshProviderModels: mocks.refreshProviderModels },
}));
vi.mock('../../model-catalog/infrastructure/httpModelCatalogGateway', () => ({
  httpModelCatalogGateway: { readRemovalImpact: mocks.readRemovalImpact },
}));
vi.mock('@shared/composables/confirmDialog', () => ({ confirm: mocks.confirm }));
vi.mock('../../../orchestration/removeModelSource', () => ({
  removeModelSource: mocks.removeModelSource,
}));
vi.mock('@/domains/settings/public', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domains/settings/public')>();
  return {
    ...actual,
    useSettingsLocalization: () => ({ settingsMessage: (key: string) => key }),
  };
});

import ModelVisibilitySettingsSection from '../ui/ModelVisibilitySettingsSection.vue';

async function flushUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
}

function invalid(id: string, displayName: string, repairable: boolean): ModelPickerUnadmittedModel {
  return {
    model_config_id: id,
    display_name: displayName,
    reason_kind: 'multiple_routes',
    reason: `用户模型 ${id} 必须声明唯一的推理 route`,
    repairable,
  };
}

function snapshot(): ModelPickerSnapshot {
  return {
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
        unadmitted_models: [
          invalid('openai-gpt-legacy', 'GPT Legacy', true),
          invalid('openai-gpt-retired', 'GPT Retired', false),
        ],
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
          {
            // 未启用的候选不属于已配置成员，删除 Provider 时不提交它。
            materialized: false,
            provider_model_id: 'gpt-candidate',
            display_name: 'GPT Candidate',
            picker_enabled: false,
            runtime_available: false,
            capabilities: ['chat'],
            image_input: false,
          },
        ],
      },
    ],
    custom_models: [],
    unassigned_unadmitted_models: [invalid('orphan-glm', 'glm-5.3-old', false)],
  };
}

/** 停用条目的界面接线：白话原因、刷新修复、单条删除、Provider 删除连带、未归类来源。 */
describe('ModelVisibilitySettingsSection 配置无效的条目', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(async () => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.removeModelSource.mockResolvedValue({
      removedModelIds: [],
      failure: null,
      synchronizationFailed: false,
    });
    mocks.readRemovalImpact.mockResolvedValue({ scheduledTaskCount: 0 });
    mocks.refreshProviderModels.mockResolvedValue(snapshot());

    const pinia = createPinia();
    setActivePinia(pinia);
    useModelPickerStore().replaceSnapshot(snapshot());
    host = document.createElement('div');
    document.body.append(host);
    app = createApp(ModelVisibilitySettingsSection, {
      activateProviderModel: vi.fn(async () => undefined),
    });
    app.use(pinia);
    app.mount(host);
    await flushUi();
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    app = undefined;
  });

  function invalidRows(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-unadmitted-model-id]'));
  }

  it('Provider 面板列出停用成员与白话原因；有可修复成员时“刷新修复”走 Provider 刷新', async () => {
    expect(invalidRows().map(row => row.dataset.unadmittedModelId)).toEqual([
      'openai-gpt-legacy',
      'openai-gpt-retired',
    ]);
    expect(invalidRows()[0]?.textContent).toContain(
      'settings.modelPicker.invalid.reason.multiple_routes'
    );
    // 原文不直接显示在行内，只在悬停提示里。
    expect(invalidRows()[0]?.textContent).not.toContain('必须声明唯一的推理 route');

    const repair = host.querySelector<HTMLButtonElement>('.model-visibility-invalid-repair');
    if (!repair) throw new Error('刷新修复入口缺失');
    repair.click();
    await flushUi();
    expect(mocks.refreshProviderModels).toHaveBeenCalledWith('configured-openai');
  });

  it('单条删除先读定时任务影响并确认，确认后按 ID 删除；取消则不删', async () => {
    mocks.readRemovalImpact.mockResolvedValue({ scheduledTaskCount: 2 });
    const deleteButton = invalidRows()[1]?.querySelector<HTMLButtonElement>('button');
    if (!deleteButton) throw new Error('删除入口缺失');

    mocks.confirm.mockResolvedValueOnce(false);
    deleteButton.click();
    await flushUi();
    expect(mocks.removeModelSource).not.toHaveBeenCalled();

    mocks.confirm.mockResolvedValueOnce(true);
    deleteButton.click();
    await flushUi();
    expect(mocks.readRemovalImpact).toHaveBeenLastCalledWith('openai-gpt-retired');
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      message: 'settings.modelDetails.confirmDelete',
      riskMessage: 'settings.modelDetails.scheduledTasksUseModel',
      isDangerousAction: true,
    });
    expect(mocks.removeModelSource.mock.lastCall?.[0]).toEqual({
      modelConfigIds: [],
      unadmittedModelConfigIds: ['openai-gpt-retired'],
    });
  });

  it('删除 Provider 时确认框列出停用成员，并把它们与已配置模型一起提交删除', async () => {
    mocks.confirm.mockResolvedValueOnce(true);
    host.querySelector<HTMLButtonElement>('.model-visibility-provider-delete')?.click();
    await flushUi();
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      message: 'settings.modelPicker.removeProvider.confirm',
      sections: [
        {
          title: 'settings.modelPicker.removeProvider.invalidSection',
          items: ['GPT Legacy', 'GPT Retired'],
        },
      ],
      isDangerousAction: true,
    });
    expect(mocks.removeModelSource).toHaveBeenCalledWith({
      modelConfigIds: ['openai-gpt-test'],
      unadmittedModelConfigIds: ['openai-gpt-legacy', 'openai-gpt-retired'],
    });
  });

  it('未归类的停用条目单独成来源，只给删除不给修复', async () => {
    host.querySelector<HTMLButtonElement>('[data-model-source-id="unassigned"]')?.click();
    await flushUi();
    expect(invalidRows().map(row => row.dataset.unadmittedModelId)).toEqual(['orphan-glm']);
    expect(host.querySelector('.model-visibility-invalid-repair')).toBeNull();
    expect(host.textContent).toContain('settings.modelPicker.unassigned.description');

    mocks.confirm.mockResolvedValueOnce(true);
    invalidRows()[0]?.querySelector<HTMLButtonElement>('button')?.click();
    await flushUi();
    expect(mocks.removeModelSource.mock.lastCall?.[0]).toEqual({
      modelConfigIds: [],
      unadmittedModelConfigIds: ['orphan-glm'],
    });
  });
});
