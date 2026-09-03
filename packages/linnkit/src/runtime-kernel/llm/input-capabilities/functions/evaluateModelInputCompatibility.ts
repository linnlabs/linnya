import type { ModelCatalogEntry } from '../../modelCatalog';
import type {
  AdapterInputSupport,
  ModelInputCompatibility,
  ModelInputPlacement,
  ModelInputRequirement,
} from '../definitions/modelInputCapability';

function supportsCapability(model: ModelCatalogEntry, capability: string): boolean {
  return model.capabilities?.includes(capability) === true;
}

function readMissingPlacements(
  support: AdapterInputSupport | undefined,
  requirement: ModelInputRequirement,
): readonly ModelInputPlacement[] {
  const missing: ModelInputPlacement[] = [];
  for (const placement of requirement.placements) {
    if (support?.[placement] !== true) {
      missing.push(placement);
    }
  }
  return Object.freeze(missing);
}

export function evaluateModelInputCompatibility(
  model: ModelCatalogEntry | undefined,
  requirement: ModelInputRequirement,
): ModelInputCompatibility {
  if (!model) {
    return { compatible: false, reason: 'model_missing', missing_placements: requirement.placements };
  }
  if (model.enabled === false) {
    return { compatible: false, reason: 'model_disabled', missing_placements: requirement.placements };
  }
  if (!supportsCapability(model, 'chat')) {
    return { compatible: false, reason: 'chat_unsupported', missing_placements: requirement.placements };
  }
  if (!requirement.requires_image_input) {
    return { compatible: true };
  }
  if (!supportsCapability(model, 'image_input')) {
    return {
      compatible: false,
      reason: 'image_input_unsupported',
      missing_placements: requirement.placements,
    };
  }

  const missingPlacements = readMissingPlacements(model.adapter_input_support, requirement);
  return missingPlacements.length === 0
    ? { compatible: true }
    : {
        compatible: false,
        reason: 'placement_unsupported',
        missing_placements: missingPlacements,
      };
}

export function listCompatibleModelIds(
  models: readonly ModelCatalogEntry[],
  requirement: ModelInputRequirement,
): readonly string[] {
  return models
    .filter(model => evaluateModelInputCompatibility(model, requirement).compatible)
    .map(model => model.id);
}
