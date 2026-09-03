import type { ConversationControlModelSummary } from '@app/schemas';
import type { ModelConfig } from 'src/domains/model-catalog';
import {
  evaluateModelRuntimeAvailability,
  type ModelRuntimeAvailabilityContext,
  type SelectableModelCapability,
} from '../../model-runtime-availability';

function projectModelSummary(
  model: ModelConfig,
  capability: SelectableModelCapability,
  context: ModelRuntimeAvailabilityContext,
): ConversationControlModelSummary {
  const availability = evaluateModelRuntimeAvailability({ model, capability, context });
  const base = {
    model_config_id: model.id,
    model_name: model.model_name,
    display_name: model.display_name.trim() || model.model_name,
    catalog_source: model.catalog_source,
    ...(capability === 'chat' && model.inference_route
      ? { input_support: { ...model.inference_route.input_support } }
      : {}),
    ...(capability === 'chat' && model.reasoning?.supported_efforts.length
      ? {
          reasoning: {
            supported_efforts: [...model.reasoning.supported_efforts],
            ...(model.reasoning.default_effort
              ? { default_effort: model.reasoning.default_effort }
              : {}),
          },
        }
      : {}),
  };
  return availability.available
    ? { ...base, available: true }
    : { ...base, available: false, unavailable_reason: availability.reason };
}

function sortModelSummaries(
  models: readonly ConversationControlModelSummary[],
): ConversationControlModelSummary[] {
  return [...models].sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    const byName = left.display_name.localeCompare(right.display_name);
    return byName !== 0
      ? byName
      : left.model_config_id.localeCompare(right.model_config_id);
  });
}

/** 投影 CLI 可复制的安全模型身份；route 与 credential identity 不得进入结果。 */
export function projectConversationControlModels(
  models: readonly ModelConfig[],
  context: ModelRuntimeAvailabilityContext,
): {
  readonly chat: readonly ConversationControlModelSummary[];
  readonly imageGeneration: readonly ConversationControlModelSummary[];
} {
  return {
    chat: sortModelSummaries(
      models
        .filter(model => model.capabilities.includes('chat'))
        .map(model => projectModelSummary(model, 'chat', context)),
    ),
    imageGeneration: sortModelSummaries(
      models
        .filter(model => model.capabilities.includes('image_generation'))
        .map(model => projectModelSummary(model, 'image_generation', context)),
    ),
  };
}
