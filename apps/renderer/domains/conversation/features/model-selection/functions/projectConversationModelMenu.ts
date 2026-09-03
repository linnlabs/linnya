import type { ModelPickerMaterializedModel } from '@app/schemas/model-picker';

import type { ModelSelectOption } from '../../../definitions/modelSelectOption';
import {
  MANAGE_CONVERSATION_MODELS_VALUE,
  type ConversationModelMenuInput,
  type ConversationModelMenuProjection,
} from '../definitions/conversationModelMenu';
import { encodeConversationModelReasoningSelection } from './conversationModelReasoningSelection';

function attachReasoningMenu(
  option: ModelSelectOption,
  modelId: string,
  input: ConversationModelMenuInput
): ModelSelectOption {
  const efforts = input.reasoning.supportedEffortsByModelId[modelId] ?? [];
  if (efforts.length === 0) return option;

  const selectedEffort = input.currentModel?.id === modelId ? input.reasoning.currentEffort : null;
  const selectedEffortLabel = selectedEffort ? input.labels.reasoningEfforts[selectedEffort] : null;

  return {
    ...option,
    text: selectedEffortLabel ? `${option.text} · ${selectedEffortLabel}` : option.text,
    allowDirectSelect: true,
    children: [
      { isGroup: true, label: input.labels.reasoning },
      ...efforts.map(effort => ({
        value: encodeConversationModelReasoningSelection(modelId, effort),
        text: input.labels.reasoningEfforts[effort],
        selected: effort === selectedEffort,
      })),
    ],
  };
}

function modelOption(
  model: ModelPickerMaterializedModel,
  input: ConversationModelMenuInput
): ModelSelectOption {
  const imageBlocked = input.hasImageDrafts && !model.image_input;
  const unavailable = !model.runtime_available;
  return attachReasoningMenu(
    {
      value: model.model_config_id,
      text: model.display_name,
      disabled: imageBlocked || unavailable,
      disabledReason: imageBlocked
        ? input.labels.imageUnsupported
        : unavailable
          ? input.labels.unavailable
          : undefined,
    },
    model.model_config_id,
    input
  );
}

function selectable(
  models: readonly ModelPickerMaterializedModel[],
  currentModelId: string | undefined
): ModelPickerMaterializedModel[] {
  return models.filter(
    model =>
      model.capabilities.includes('chat') &&
      ((model.picker_enabled && model.runtime_available) ||
        model.model_config_id === currentModelId)
  );
}

function appendDirectGroup(
  target: ModelSelectOption[],
  modelIds: Set<string>,
  label: string,
  models: readonly ModelPickerMaterializedModel[],
  input: ConversationModelMenuInput
): void {
  const options = selectable(models, input.currentModel?.id).map(model =>
    modelOption(model, input)
  );
  if (options.length === 0) return;
  target.push({ isGroup: true, label }, ...options);
  for (const option of options) {
    if (option.value) modelIds.add(option.value);
  }
}

function appendSeparator(target: ModelSelectOption[]): void {
  const last = target[target.length - 1];
  if (target.length > 0 && !last?.isSeparator) target.push({ isSeparator: true });
}

/**
 * 对话快捷选择器只投影 Host 已判定的来源、显隐与运行时可用性。
 * Provider 归属、Cloud 特权和自定义模型语义都不允许在 Renderer 再猜一次。
 */
export function projectConversationModelMenu(
  input: ConversationModelMenuInput
): ConversationModelMenuProjection {
  const options: ModelSelectOption[] = [];
  const normalModelIds = new Set<string>();
  const snapshot = input.snapshot;

  if (snapshot?.cloud) {
    appendDirectGroup(
      options,
      normalModelIds,
      snapshot.cloud.display_name,
      snapshot.cloud.models,
      input
    );
  }

  const providerOptions: ModelSelectOption[] = [];
  for (const provider of snapshot?.providers ?? []) {
    const currentProviderModel = provider.models.some(
      model => model.materialized && model.model_config_id === input.currentModel?.id
    );
    const providerSelectable = provider.picker_enabled && provider.credential_available;
    if (!providerSelectable && !currentProviderModel) {
      continue;
    }
    const materializedModels = provider.models.filter(
      (model): model is ModelPickerMaterializedModel =>
        model.materialized && model.capabilities.includes('chat')
    );
    const children = (
      providerSelectable
        ? selectable(materializedModels, input.currentModel?.id)
        : materializedModels.filter(model => model.model_config_id === input.currentModel?.id)
    ).map(model => modelOption(model, input));
    if (children.length === 0) continue;
    providerOptions.push({
      text: provider.display_name,
      shortcut: String(children.length),
      children,
    });
    for (const child of children) {
      if (child.value) normalModelIds.add(child.value);
    }
  }
  if (providerOptions.length > 0) {
    options.push({ isGroup: true, label: input.labels.provider }, ...providerOptions);
  }

  if (snapshot) {
    appendDirectGroup(options, normalModelIds, input.labels.custom, snapshot.custom_models, input);
  }

  if (input.currentModel && !normalModelIds.has(input.currentModel.id)) {
    const imageBlocked = input.hasImageDrafts && !input.currentModel.imageInput;
    const currentOption = attachReasoningMenu(
      {
        value: input.currentModel.id,
        text: input.currentModel.displayName,
        disabled: imageBlocked,
        disabledReason: imageBlocked ? input.labels.imageUnsupported : undefined,
      },
      input.currentModel.id,
      input
    );
    options.unshift({ isSeparator: true });
    options.unshift({ ...currentOption, shortcut: input.labels.current });
  }

  appendSeparator(options);
  options.push({ value: MANAGE_CONVERSATION_MODELS_VALUE, text: input.labels.manage });

  return { options };
}
