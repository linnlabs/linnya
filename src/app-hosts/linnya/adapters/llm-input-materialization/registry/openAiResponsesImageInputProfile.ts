import { CONVERSATION_IMAGE_MAX_TOTAL_BYTES } from '@app/schemas';
import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';
import { estimateOpenAiImageTokens } from '../functions/estimateOpenAiImageTokens';

/**
 * Responses v1 使用内联 data URL 与 detail=auto。
 * 数量上限与当前产品入口保持一致；字节与 token 仍由各自边界独立约束。
 */
export const OPENAI_RESPONSES_IMAGE_INPUT_PROFILE: Extract<
  ImageInputProcessingProfile,
  { readonly apiSurface: 'openai_responses' }
> = Object.freeze({
  id: 'openai-responses-inline-auto-v1',
  apiSurface: 'openai_responses',
  transport: 'inline',
  detail: 'auto',
  estimatorVersion: 'conservative-512px-tiles-v1',
  estimateTokens: estimateOpenAiImageTokens,
  limits: Object.freeze({
    maxImages: 100,
    maxImageBytes: 10 * 1024 * 1024,
    maxTotalImageBytes: CONVERSATION_IMAGE_MAX_TOTAL_BYTES,
  }),
});
