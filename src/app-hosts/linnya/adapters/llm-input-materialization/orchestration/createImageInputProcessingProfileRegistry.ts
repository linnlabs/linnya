import {
  LLM_IMAGE_INPUT_ERROR_CODES,
  LlmImageInputError,
} from 'linnkit/runtime-kernel';
import type { LlmImageInputDescriptor } from 'linnkit/ports';
import type {
  ImageInputProcessingProfileBinding,
  ImageInputProcessingProfileRegistry,
} from '../definitions/imageInputProcessingProfileRegistry';

export function createImageInputProcessingProfileRegistry(params: {
  readonly resolveRouteForModel: (activeModelId: string) => string | undefined;
  readonly bindings: readonly ImageInputProcessingProfileBinding[];
}): ImageInputProcessingProfileRegistry {
  const profilesByRoute = new Map(
    params.bindings.map(binding => [binding.route, binding.profile]),
  );

  const resolveForModel = (activeModelId: string) => {
    const route = params.resolveRouteForModel(activeModelId);
    return route ? profilesByRoute.get(route) : undefined;
  };

  return {
    resolveForModel,
    estimateImageInput(activeModelId: string, descriptor: LlmImageInputDescriptor) {
      const profile = resolveForModel(activeModelId);
      if (!profile) {
        throw new LlmImageInputError(
          LLM_IMAGE_INPUT_ERROR_CODES.MAPPING_UNSUPPORTED,
          'No image input processing profile is registered for the active model route.',
          {
            active_model_id: activeModelId,
            placement: descriptor.placement,
            attachment_id: descriptor.id,
            resource_id: descriptor.resourceId,
          },
        );
      }
      return {
        estimatedTokens: profile.estimateTokens({
          width: descriptor.width,
          height: descriptor.height,
        }),
        profileId: profile.id,
        estimatorVersion: profile.estimatorVersion,
      };
    },
  };
}
