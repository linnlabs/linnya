import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';
import { estimateOpenAiImageTokens } from '../functions/estimateOpenAiImageTokens';

export const CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE: Extract<
  ImageInputProcessingProfile,
  { readonly apiSurface: 'openai_chat_completions' }
> = Object.freeze({
  id: 'chat-completions-inline-auto-v1',
  apiSurface: 'openai_chat_completions',
  transport: 'inline',
  detail: 'auto',
  estimatorVersion: 'conservative-512px-tiles-v1',
  estimateTokens: estimateOpenAiImageTokens,
  limits: Object.freeze({
    maxImages: 100,
    maxImageBytes: 10 * 1024 * 1024,
    maxTotalImageBytes: 20 * 1024 * 1024,
  }),
});
