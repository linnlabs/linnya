import { computed, type ComputedRef } from 'vue';
import {
  setModelPurposeBinding,
  setPrimaryReasoningEffort,
  modelAcceptsUserImageInput,
  type ModelCatalogReadModel,
  type ModelPickerReadModel,
  type ModelPurposeBindingsReadModel,
} from '@/domains/model-configuration';

import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import type { ModelSelectOption } from '../../../definitions/modelSelectOption';
import { readConversationModelReasoningSelection } from '../functions/conversationModelReasoningSelection';
import { projectConversationModelMenu } from '../functions/projectConversationModelMenu';

export interface ConversationModelSelectionSources {
  readonly modelCatalog: ModelCatalogReadModel;
  readonly modelPicker: ModelPickerReadModel;
  readonly modelBindings: ModelPurposeBindingsReadModel;
  readonly hasImageDrafts: () => boolean;
  readonly isDisabled: () => boolean;
  readonly conversationMessage: ConversationMessageResolver;
}

export interface ConversationModelSelectionReadModel {
  readonly primaryModelValue: ComputedRef<string | null>;
  readonly modelSelectOptions: ComputedRef<ModelSelectOption[]>;
  selectPrimaryModelMenuValue(value: string | null): void;
}

/**
 * 对话模型选择的 Vue 编排边界：目录和 picker 只负责提供事实，纯投影负责菜单结构，
 * 最终选择仍分别提交给既有的模型与 reasoning binding。
 */
export function useConversationModelSelection(
  sources: ConversationModelSelectionSources
): ConversationModelSelectionReadModel {
  const primaryModelValue = computed(() => sources.modelBindings.effectivePrimaryModelId.value);
  const currentModelPresentation = computed(() => {
    const currentModelId = primaryModelValue.value;
    if (!currentModelId) return null;
    const model = sources.modelCatalog.models.value.find(
      candidate => candidate.id === currentModelId
    );
    if (!model) return null;
    return {
      id: model.id,
      displayName: model.display_name || model.name || model.id,
      imageInput: modelAcceptsUserImageInput(model),
    };
  });

  const modelSelectOptions = computed<ModelSelectOption[]>(() => [
    ...projectConversationModelMenu({
      snapshot: sources.modelPicker.snapshot.value,
      currentModel: currentModelPresentation.value,
      hasImageDrafts: sources.hasImageDrafts(),
      labels: {
        custom: sources.conversationMessage('conversation.input.modelGroup.custom'),
        provider: sources.conversationMessage('conversation.input.modelGroup.provider'),
        current: sources.conversationMessage('conversation.input.modelGroup.current'),
        manage: sources.conversationMessage('conversation.input.model.manage'),
        imageUnsupported: sources.conversationMessage('conversation.input.model.imageUnsupported'),
        unavailable: sources.conversationMessage('conversation.input.model.unavailable'),
        reasoning: sources.conversationMessage('conversation.input.reasoning.placeholder'),
        reasoningEfforts: {
          off: sources.conversationMessage('conversation.input.reasoning.off'),
          minimal: sources.conversationMessage('conversation.input.reasoning.minimal'),
          low: sources.conversationMessage('conversation.input.reasoning.low'),
          medium: sources.conversationMessage('conversation.input.reasoning.medium'),
          high: sources.conversationMessage('conversation.input.reasoning.high'),
          xhigh: sources.conversationMessage('conversation.input.reasoning.xhigh'),
        },
      },
      reasoning: {
        currentEffort: sources.modelBindings.effectivePrimaryReasoningEffort.value,
        supportedEffortsByModelId: Object.fromEntries(
          sources.modelCatalog.models.value.map(model => [
            model.id,
            model.reasoning?.supported_efforts ?? [],
          ])
        ),
      },
    }).options,
  ]);

  function selectPrimaryModelMenuValue(value: string | null): void {
    if (sources.isDisabled()) return;
    if (value) {
      const reasoningSelection = readConversationModelReasoningSelection(value);
      if (reasoningSelection) {
        setModelPurposeBinding('primary', reasoningSelection.modelId);
        setPrimaryReasoningEffort(reasoningSelection.effort);
        return;
      }
    }
    setModelPurposeBinding('primary', value);
  }

  return {
    primaryModelValue,
    modelSelectOptions,
    selectPrimaryModelMenuValue,
  };
}
