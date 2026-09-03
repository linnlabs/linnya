import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';

const ANTHROPIC_PATCH_EDGE_PX = 28;
const HIGH_RESOLUTION_VISUAL_TOKEN_LIMIT = 4784;

function estimateAnthropicImageTokens(dimensions: {
  readonly width: number;
  readonly height: number;
}): number {
  const patches =
    Math.ceil(dimensions.width / ANTHROPIC_PATCH_EDGE_PX) *
    Math.ceil(dimensions.height / ANTHROPIC_PATCH_EDGE_PX);
  return Math.min(patches, HIGH_RESOLUTION_VISUAL_TOKEN_LIMIT);
}

export const ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE: Extract<
  ImageInputProcessingProfile,
  { readonly apiSurface: 'anthropic_messages' }
> = Object.freeze({
  id: 'anthropic-messages-inline-base64-v1',
  apiSurface: 'anthropic_messages',
  transport: 'inline',
  estimatorVersion: 'anthropic-28px-patches-high-res-v1',
  estimateTokens: estimateAnthropicImageTokens,
  limits: Object.freeze({
    maxImages: 100,
    // Anthropic 的 10 MB 限制针对 base64 编码后载荷，raw bytes 需预留约 4/3 膨胀。
    maxImageBytes: 7 * 1024 * 1024,
    maxTotalImageBytes: 20 * 1024 * 1024,
  }),
});
