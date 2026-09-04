import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';

const PATCH_EDGE_PX = 28;
const CONSERVATIVE_VISUAL_TOKEN_LIMIT = 4784;

function estimateOllamaImageTokens(dimensions: {
  readonly width: number;
  readonly height: number;
}): number {
  const patches =
    Math.ceil(dimensions.width / PATCH_EDGE_PX) * Math.ceil(dimensions.height / PATCH_EDGE_PX);
  return Math.min(patches, CONSERVATIVE_VISUAL_TOKEN_LIMIT);
}

/** Ollama 原生 Chat 的 inline base64 图片预算与限制。 */
export const OLLAMA_CHAT_IMAGE_INPUT_PROFILE: Extract<
  ImageInputProcessingProfile,
  { readonly apiSurface: 'ollama_chat' }
> = Object.freeze({
  id: 'ollama-chat-inline-base64-v1',
  apiSurface: 'ollama_chat',
  transport: 'inline',
  estimatorVersion: 'conservative-28px-patches-v1',
  estimateTokens: estimateOllamaImageTokens,
  limits: Object.freeze({
    maxImages: 100,
    maxImageBytes: 10 * 1024 * 1024,
    maxTotalImageBytes: 20 * 1024 * 1024,
  }),
});
