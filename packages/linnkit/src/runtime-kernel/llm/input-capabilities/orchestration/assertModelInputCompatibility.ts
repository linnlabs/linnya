import { Logger } from '../../../../shared/logger';
import type { ModelCatalogLike } from '../../modelCatalog';
import type { ModelInputRequirement } from '../definitions/modelInputCapability';
import { createModelInputCompatibilityError } from '../functions/createModelInputCompatibilityError';
import {
  evaluateModelInputCompatibility,
  listCompatibleModelIds,
} from '../functions/evaluateModelInputCompatibility';

const logger = new Logger('LlmInputCapabilities');

export function assertModelInputCompatibility(input: {
  readonly modelCatalog: ModelCatalogLike;
  readonly modelId: string;
  readonly requirement: ModelInputRequirement;
}): void {
  const compatibility = evaluateModelInputCompatibility(
    input.modelCatalog.getModelById(input.modelId),
    input.requirement,
  );

  if (compatibility.compatible) {
    logger.debug('LLM 输入能力校验通过', {
      modelId: input.modelId,
      requiredPlacements: input.requirement.placements,
    });
    return;
  }

  const compatibleModelIds = input.requirement.requires_image_input
    ? listCompatibleModelIds(
        input.modelCatalog.getModelsByCapability('chat'),
        input.requirement,
      )
    : undefined;

  logger.warn('LLM 输入能力校验拒绝调用', {
    modelId: input.modelId,
    requiredPlacements: input.requirement.placements,
    reason: compatibility.reason,
    compatibleModelIds,
  });
  throw createModelInputCompatibilityError({
    modelId: input.modelId,
    requirement: input.requirement,
    incompatibility: compatibility,
    compatibleModelIds,
  });
}
