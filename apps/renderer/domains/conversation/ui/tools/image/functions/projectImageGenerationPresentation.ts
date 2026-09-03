import {
  HistoricalImageGenerationResultSchema,
  ImageGenerationArgsSchema,
  ImageGenerationResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type {
  ImageGenerationPresentationData,
  ImageGenerationPresentationImage,
} from '../definitions/imageGenerationPresentation';

const IMAGE_GENERATION_TOOL_NAMES = new Set(['generate_image', 'text_to_image']);

function projectImages(resultValue: unknown): readonly ImageGenerationPresentationImage[] {
  const live = ImageGenerationResultSchema.safeParse(resultValue);
  const result = live.success
    ? live.data
    : HistoricalImageGenerationResultSchema.parse(resultValue);
  if (result.media && result.media.length > 0) {
    return result.media.map(media => ({
      path: media.path,
      ...(media.media_type ? { mediaType: media.media_type } : {}),
      width: media.width,
      height: media.height,
    }));
  }
  const paths = typeof result.data === 'string' ? [result.data] : result.data;
  return paths.map(path => ({ path }));
}

export function projectImageGenerationPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<ImageGenerationPresentationData> {
  if (
    input.sourceToolName !== input.uiKey
    || !IMAGE_GENERATION_TOOL_NAMES.has(input.sourceToolName)
  ) {
    throw new Error(
      `Unsupported image generation presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }

  if (input.status === 'success') {
    ImageGenerationArgsSchema.parse(input.args);
  }
  return {
    data: {
      images: input.status === 'success' ? projectImages(input.result) : [],
    },
  };
}
