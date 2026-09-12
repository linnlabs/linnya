import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';

/**
 * DeepSeek Vision 官方合同（2026-09-12）：https://api-docs.deepseek.com/guides/vision/
 * 使用每图 1024 tokens 的已公布上界，不把其他厂商的 tile/patch 公式当作实际计费。
 */
export const DEEPSEEK_CHAT_IMAGE_INPUT_PROFILE: Extract<
  ImageInputProcessingProfile,
  { readonly apiSurface: 'openai_chat_completions' }
> = Object.freeze({
  id: 'deepseek-chat-inline-auto-v1',
  apiSurface: 'openai_chat_completions',
  transport: 'inline',
  detail: 'auto',
  estimatorVersion: 'deepseek-1024-token-upper-bound-2026-09-12',
  estimateTokens: () => 1024,
  limits: Object.freeze({
    maxImages: 600,
    maxImageBytes: 32 * 1024 * 1024,
    // 32 MiB raw 约占 42.67 MiB base64，给 48 MiB 请求体留余量；不是完整 wire body 的校验。
    maxTotalImageBytes: 32 * 1024 * 1024,
    maxImageEdgePixels: (imageCount: number) => imageCount >= 15 ? 4096 : 8192,
  }),
});
