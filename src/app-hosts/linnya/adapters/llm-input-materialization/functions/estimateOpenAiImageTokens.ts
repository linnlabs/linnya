const IMAGE_TILE_EDGE_PX = 512;
const BASE_IMAGE_TOKENS = 85;
const TOKENS_PER_TILE = 170;

/**
 * OpenAI 图片 detail=auto 可能按高细节处理，因此预算按完整 tile 保守估算。
 * Chat Completions 与 Responses 必须共用本函数，避免 admission 与真实 transport 漂移。
 */
export function estimateOpenAiImageTokens(dimensions: {
  readonly width: number;
  readonly height: number;
}): number {
  const horizontalTiles = Math.ceil(dimensions.width / IMAGE_TILE_EDGE_PX);
  const verticalTiles = Math.ceil(dimensions.height / IMAGE_TILE_EDGE_PX);
  return BASE_IMAGE_TOKENS + horizontalTiles * verticalTiles * TOKENS_PER_TILE;
}
