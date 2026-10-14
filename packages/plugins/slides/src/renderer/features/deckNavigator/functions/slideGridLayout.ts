import { resolveThumbnailHeightForWidth } from '../../../shared/thumbnailGeometry';
import type { SlideGridLayout, SlideGridLayoutInput } from '../definitions/deckNavigatorTypes';

export const SLIDE_GRID_PADDING_X_PX = 32;
export const SLIDE_GRID_COLUMN_GAP_PX = 24;
export const SLIDE_GRID_ROW_GAP_PX = 20;
/** 缩略图下方页码行高度。 */
export const SLIDE_GRID_CAPTION_HEIGHT_PX = 26;
const MIN_CELL_WIDTH_PX = 240;
const MAX_CELL_WIDTH_PX = 360;
const RASTER_WIDTH_STEP_PX = 64;
const MAX_RASTER_WIDTH_PX = 384;

/** 列数取能放下最小卡片宽度的最大值，剩余宽度均分给每列；过宽时卡片封顶并整体居中。 */
export function resolveSlideGridLayout(input: SlideGridLayoutInput): SlideGridLayout {
  const available = Math.max(input.viewportWidth - SLIDE_GRID_PADDING_X_PX * 2, MIN_CELL_WIDTH_PX);
  const columns = Math.max(
    1,
    Math.floor((available + SLIDE_GRID_COLUMN_GAP_PX) / (MIN_CELL_WIDTH_PX + SLIDE_GRID_COLUMN_GAP_PX)),
  );
  const cellWidth = Math.floor(Math.min(
    MAX_CELL_WIDTH_PX,
    (available - SLIDE_GRID_COLUMN_GAP_PX * (columns - 1)) / columns,
  ));
  const thumbnailHeight = resolveThumbnailHeightForWidth(input.slideSize, cellWidth);
  const rows: number[][] = [];
  for (let index = 0; index < input.slideCount; index += columns) {
    rows.push(Array.from({ length: Math.min(columns, input.slideCount - index) }, (_, offset) => index + offset));
  }
  return {
    columns,
    cellWidth,
    thumbnailHeight,
    rowHeight: thumbnailHeight + SLIDE_GRID_CAPTION_HEIGHT_PX + SLIDE_GRID_ROW_GAP_PX,
    rows,
    rasterWidth: Math.min(MAX_RASTER_WIDTH_PX, Math.ceil(cellWidth / RASTER_WIDTH_STEP_PX) * RASTER_WIDTH_STEP_PX),
  };
}
