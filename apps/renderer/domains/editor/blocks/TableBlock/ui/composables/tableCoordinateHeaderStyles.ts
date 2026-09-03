import type { CSSProperties } from 'vue';
import type { PointMetrics, RectMetrics } from './tableCoordinateHeaderMetrics';

export const TABLE_COLUMN_HEADER_HEIGHT = 28;
export const TABLE_ROW_HEADER_WIDTH = 40;
export const TABLE_COLUMN_HEADER_Z_INDEX = 202;
export const TABLE_ROW_HEADER_Z_INDEX = 201;

export interface TableColumnHeaderStyleParams {
  columnWidths: readonly number[];
  tableRect: RectMetrics;
  scrollLeft: number;
  containerRect: PointMetrics;
  tableScrollContainerRect: PointMetrics;
  visibleWidth: number;
  hasScrollContainer: boolean;
}

export interface TableColumnHeaderStyles {
  floatingStyle: CSSProperties;
  scrollerStyle: CSSProperties;
}

export interface TableRowHeaderStyleParams {
  tableRect: RectMetrics;
  tableScrollContainerRect: PointMetrics;
  editorShellBottom: number;
}

function sumFiniteWidths(widths: readonly number[]): number {
  return widths.reduce((sum, width) => {
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? sum + width : sum;
  }, 0);
}

/**
 * 构造列标定位样式。
 *
 * 中文说明：
 * - 只依赖父 controller 已测量出的几何数据，不直接读取 DOM；
 * - 这样 hydrate 后横向滚动容器重绑只发生在 controller，列标组件不再持有陈旧 autoUpdate。
 */
export function buildTableColumnHeaderStyles(
  params: TableColumnHeaderStyleParams
): TableColumnHeaderStyles {
  const totalWidth = sumFiniteWidths(params.columnWidths);

  if (!params.hasScrollContainer || totalWidth <= 0) {
    return {
      floatingStyle: {
        visibility: 'hidden',
      },
      scrollerStyle: {},
    };
  }

  const maxWidth = params.visibleWidth > 0 ? params.visibleWidth : params.tableRect.width;
  const containerWidth = Math.max(0, Math.min(totalWidth, maxWidth));
  const stickyTop = params.containerRect.top;
  const tableBottomInViewport = params.tableRect.top + params.tableRect.height;
  const isTableVisible = tableBottomInViewport > stickyTop;

  return {
    floatingStyle: {
      position: 'fixed',
      left: `${params.tableScrollContainerRect.left}px`,
      top: `${Math.max(params.tableScrollContainerRect.top - TABLE_COLUMN_HEADER_HEIGHT, stickyTop)}px`,
      height: `${TABLE_COLUMN_HEADER_HEIGHT}px`,
      width: `${containerWidth}px`,
      overflow: 'hidden',
      zIndex: TABLE_COLUMN_HEADER_Z_INDEX,
      visibility: isTableVisible ? 'visible' : 'hidden',
    },
    scrollerStyle: {
      width: `${totalWidth}px`,
      transform: `translateX(-${params.scrollLeft}px)`,
    },
  };
}

/**
 * 构造行标定位样式。
 */
export function buildTableRowHeaderStyle(params: TableRowHeaderStyleParams): CSSProperties {
  const finalX = params.tableScrollContainerRect.left - TABLE_ROW_HEADER_WIDTH;
  const finalY = params.tableRect.top;
  let finalHeight = params.tableRect.height;

  if (params.editorShellBottom > 0) {
    const rowHeaderBottom = finalY + finalHeight;
    if (rowHeaderBottom > params.editorShellBottom) {
      finalHeight -= rowHeaderBottom - params.editorShellBottom;
    }
  }

  return {
    position: 'fixed',
    left: `${finalX}px`,
    top: `${finalY}px`,
    width: `${TABLE_ROW_HEADER_WIDTH}px`,
    height: `${Math.max(0, finalHeight)}px`,
    zIndex: TABLE_ROW_HEADER_Z_INDEX,
  };
}
