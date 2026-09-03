export interface ConversationImageDimensions {
  width?: number;
  height?: number;
}

export interface ConversationImageBoxSize {
  widthPx: number;
  heightPx: number;
}

export const CONVERSATION_IMAGE_MAX_WIDTH_PX = 600;
export const CONVERSATION_IMAGE_MAX_HEIGHT_PX = 400;
const CONVERSATION_COMPACT_IMAGE_RESULT_SCALE = 0.5;
const IMAGE_GENERATION_GRID_MIN_COLUMN_WIDTH_PX = 200;
const IMAGE_GENERATION_GRID_GAP_PX = 16;

export interface ImageGenerationSingleRatio {
  width: number;
  height: number;
}

export interface ImageGenerationGridLayout {
  columnCount: number;
  rowCount: number;
  itemSizePx: number;
  totalHeightPx: number;
}

function readPositiveFiniteNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function resolveSafeContentWidth(contentWidthPx: number): number {
  return Number.isFinite(contentWidthPx) && contentWidthPx > 0
    ? contentWidthPx
    : CONVERSATION_IMAGE_MAX_WIDTH_PX;
}

export function calculateConversationImageBoxSize(
  dimensions: ConversationImageDimensions | null | undefined,
  contentWidthPx: number,
): ConversationImageBoxSize | null {
  const width = readPositiveFiniteNumber(dimensions?.width);
  const height = readPositiveFiniteNumber(dimensions?.height);
  if (width === null || height === null) return null;

  const safeContentWidth = resolveSafeContentWidth(contentWidthPx);
  const widthAtWidthCap = Math.min(safeContentWidth, CONVERSATION_IMAGE_MAX_WIDTH_PX);
  const heightAtWidthCap = widthAtWidthCap * (height / width);

  if (heightAtWidthCap <= CONVERSATION_IMAGE_MAX_HEIGHT_PX) {
    return { widthPx: widthAtWidthCap, heightPx: heightAtWidthCap };
  }

  return {
    widthPx: CONVERSATION_IMAGE_MAX_HEIGHT_PX * (width / height),
    heightPx: CONVERSATION_IMAGE_MAX_HEIGHT_PX,
  };
}

export function calculateConversationImageReservedBoxSize(
  dimensions: ConversationImageDimensions | null | undefined,
  contentWidthPx: number,
): ConversationImageBoxSize {
  const metadataBoxSize = calculateConversationImageBoxSize(dimensions, contentWidthPx);
  if (metadataBoxSize) return metadataBoxSize;

  // 存量图片没有尺寸元数据时，固定盒高是唯一能保证 decode 前后几何不变的口径。
  return {
    widthPx: Math.min(resolveSafeContentWidth(contentWidthPx), CONVERSATION_IMAGE_MAX_WIDTH_PX),
    heightPx: CONVERSATION_IMAGE_MAX_HEIGHT_PX,
  };
}

/**
 * 工具读取图片只展示识别上下文，不应与 AI 生成结果形成相同的视觉权重。
 * 这里复用生成图片的完整尺寸计算后等比缩小一半，确保横图、竖图和存量图片遵循同一规则。
 */
export function calculateCompactConversationImageResultBoxSize(
  dimensions: ConversationImageDimensions | null | undefined,
  contentWidthPx: number,
): ConversationImageBoxSize {
  const resultBoxSize = calculateConversationImageReservedBoxSize(dimensions, contentWidthPx);
  return {
    widthPx: resultBoxSize.widthPx * CONVERSATION_COMPACT_IMAGE_RESULT_SCALE,
    heightPx: resultBoxSize.heightPx * CONVERSATION_COMPACT_IMAGE_RESULT_SCALE,
  };
}

export function calculateImageGenerationGridLayout(
  imageCount: number,
  contentWidthPx: number,
): ImageGenerationGridLayout {
  const safeImageCount = Number.isFinite(imageCount) ? Math.max(0, Math.floor(imageCount)) : 0;
  if (safeImageCount <= 0) {
    return {
      columnCount: 0,
      rowCount: 0,
      itemSizePx: 0,
      totalHeightPx: 0,
    };
  }

  const safeContentWidth = Number.isFinite(contentWidthPx) && contentWidthPx > 0
    ? contentWidthPx
    : IMAGE_GENERATION_GRID_MIN_COLUMN_WIDTH_PX;
  /**
   * 与 ImageRenderer.css 保持一致：
   * - .image-grid: grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))
   * - .image-grid: gap: 1rem（当前主题下为 16px）
   *
   * 这里按真实 CSS 几何预估多图卡片高度，避免 lazy 图片加载后再触发大幅测高修正。
   */
  const maxColumnCount = Math.max(1, Math.floor(
    (safeContentWidth + IMAGE_GENERATION_GRID_GAP_PX)
    / (IMAGE_GENERATION_GRID_MIN_COLUMN_WIDTH_PX + IMAGE_GENERATION_GRID_GAP_PX),
  ));
  const columnCount = Math.min(safeImageCount, maxColumnCount);
  const rowCount = Math.ceil(safeImageCount / columnCount);
  const itemSizePx = (
    safeContentWidth - Math.max(columnCount - 1, 0) * IMAGE_GENERATION_GRID_GAP_PX
  ) / columnCount;
  const totalHeightPx = rowCount * itemSizePx
    + Math.max(rowCount - 1, 0) * IMAGE_GENERATION_GRID_GAP_PX;

  return {
    columnCount,
    rowCount,
    itemSizePx,
    totalHeightPx,
  };
}

export function calculateImageGenerationResultHeight(
  imageCount: number,
  singleImageRatio: ImageGenerationSingleRatio | null | undefined,
  contentWidthPx: number,
): number {
  const safeImageCount = Number.isFinite(imageCount) ? Math.max(0, Math.floor(imageCount)) : 0;
  if (safeImageCount <= 0) return 0;

  const safeContentWidth = Number.isFinite(contentWidthPx) && contentWidthPx > 0
    ? contentWidthPx
    : IMAGE_GENERATION_GRID_MIN_COLUMN_WIDTH_PX;

  if (safeImageCount === 1) {
    return calculateConversationImageReservedBoxSize(singleImageRatio, safeContentWidth).heightPx;
  }

  return calculateImageGenerationGridLayout(safeImageCount, safeContentWidth).totalHeightPx;
}
