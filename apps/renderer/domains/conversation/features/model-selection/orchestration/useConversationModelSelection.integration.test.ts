import { createPinia, setActivePinia } from 'pinia';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type { ReasoningEffort } from '@linnlabs/linnkit/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadModelPicker,
  startModelCatalogLifecycle,
  stopModelCatalogLifecycle,
  useModelCatalogReadModel,
  useModelPickerReadModel,
  useModelPurposeBindings,
  type ModelCatalogItem,
} from '@/domains/model-configuration';

import { encodeConversationModelReasoningSelection } from '../functions/conversationModelReasoningSelection';
import { useConversationModelSelection } from './useConversationModelSelection';

const http = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));

vi.mock('@shared/services/localApiClient', () => ({
  apiFetch: http.fetch,
  getApiBaseUrl: async () => 'http://fixture.local',
}));

const modelId = 'custom-claude';
const otherModelId = 'other-model';
const currentReasoning: NonNullable<ModelCatalogItem['reasoning']> = {
  supported_efforts: ['low', 'medium', 'high', 'xhigh'],
  default_effort: 'medium',
};

function catalogResponse(reasoning: ModelCatalogItem['reasoning']): Response {
  const models: ModelCatalogItem[] = [
    {
      id: modelId,
      model_name: 'claude-sonnet-5-5',
      display_name: 'Claude Sonnet',
      catalog_source: 'user',
      capabilities: ['chat'],
      ...(reasoning ? { reasoning } : {}),
    },
    { id: otherModelId, catalog_source: 'user', capabilities: ['chat'] },
  ];
  return Response.json({ models, task_defaults: {}, cloud_models_ready: false });
}

const pickerSnapshot: ModelPickerSnapshot = {
  providers: [],
  custom_models: [modelId, otherModelId].map(id => ({
    materialized: true,
    model_config_id: id,
    display_name: id === modelId ? 'Claude Sonnet' : 'Other model',
    capabilities: ['chat'],
    picker_enabled: true,
    runtime_available: true,
    image_input: false,
  })),
};

const cases: readonly {
  readonly label: string;
  readonly initialReasoning: ModelCatalogItem['reasoning'];
  readonly selectedEffort: ReasoningEffort | null;
}[] = [
  { label: '未选择强度时采用 medium', initialReasoning: undefined, selectedEffort: null },
  {
    label: '旧 off 不再支持时显示有效 medium 并保留偏好',
    initialReasoning: {
      supported_efforts: ['off', 'low', 'medium', 'high'],
      default_effort: 'medium',
    },
    selectedEffort: 'off',
  },
];

describe('对话模型菜单接纳更新后的 reasoning 能力', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    http.fetch.mockReset();
    vi.stubGlobal('window', { electronAPI: { on: vi.fn(() => vi.fn()) } });
  });

  afterEach(() => {
    stopModelCatalogLifecycle();
    vi.unstubAllGlobals();
  });

  it.each(cases)('$label，目录更新不要求重新选择或注册模型', async scenario => {
    http.fetch.mockResolvedValueOnce(catalogResponse(scenario.initialReasoning));
    await startModelCatalogLifecycle();
    http.fetch.mockResolvedValueOnce(Response.json(pickerSnapshot));
    await loadModelPicker();

    const modelPicker = useModelPickerReadModel();
    const bindings = useModelPurposeBindings();
    const selection = useConversationModelSelection({
      modelCatalog: useModelCatalogReadModel(),
      modelPicker,
      modelBindings: bindings,
      hasImageDrafts: () => false,
      isDisabled: () => false,
      conversationMessage: key => key,
    });
    selection.selectPrimaryModelMenuValue(
      scenario.selectedEffort
        ? encodeConversationModelReasoningSelection(modelId, scenario.selectedEffort)
        : modelId
    );

    const initialOption = selection.modelSelectOptions.value.find(option => option.value === modelId);
    if (scenario.selectedEffort === null) {
      expect(initialOption?.children).toBeUndefined();
      expect(bindings.effectivePrimaryReasoningEffort.value).toBeNull();
    } else {
      expect(initialOption?.children).toContainEqual(expect.objectContaining({
        value: encodeConversationModelReasoningSelection(modelId, 'off'),
        selected: true,
      }));
      expect(bindings.effectivePrimaryReasoningEffort.value).toBe('off');
    }

    // 同一个选择器实例只重读目录；能力更新不依赖重新创建 picker 或重写用户绑定。
    const previousPickerSnapshot = modelPicker.snapshot.value;
    http.fetch.mockResolvedValueOnce(catalogResponse(currentReasoning));
    await startModelCatalogLifecycle();

    const updatedOption = selection.modelSelectOptions.value.find(option => option.value === modelId);
    expect(updatedOption?.children?.filter(option => !option.isGroup)).toEqual(
      currentReasoning.supported_efforts.map(effort => ({
        value: encodeConversationModelReasoningSelection(modelId, effort),
        text: `conversation.input.reasoning.${effort}`,
        selected: effort === 'medium',
      }))
    );
    expect(updatedOption?.text).toBe('Claude Sonnet · conversation.input.reasoning.medium');
    expect(modelPicker.snapshot.value).toBe(previousPickerSnapshot);
    expect(selection.primaryModelValue.value).toBe(modelId);
    expect(bindings.selections.primaryModelId.value).toBe(modelId);
    expect(bindings.effectivePrimaryReasoningEffort.value).toBe('medium');
    expect(bindings.selections.primaryReasoningEffort.value).toBe(scenario.selectedEffort);

    // 切换回来仍保留按模型记忆的原偏好，而不是把读时降级结果保存成用户选择。
    selection.selectPrimaryModelMenuValue(otherModelId);
    selection.selectPrimaryModelMenuValue(modelId);
    expect(selection.primaryModelValue.value).toBe(modelId);
    expect(bindings.selections.primaryReasoningEffort.value).toBe(scenario.selectedEffort);
    expect(bindings.effectivePrimaryReasoningEffort.value).toBe('medium');
    expect(http.fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://fixture.local/api/v1/models',
      'http://fixture.local/api/v1/model-picker',
      'http://fixture.local/api/v1/models',
    ]);
  });
});
