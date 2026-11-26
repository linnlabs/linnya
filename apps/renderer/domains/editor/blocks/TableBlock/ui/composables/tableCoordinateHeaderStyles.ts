import type { CSSProperties } from 'vue';
import type { PointMetrics, RectMetrics } from './tableCoordinateHeaderMetrics';

export const TABLE_COLUMN_HEADER_HEIGHT = 28;
export const TABLE_ROW_HEADER_WIDTH = 40;
export const TABLE_COLUMN_HEADER_Z_INDEX = 202;
export const TABLE_ROW_HEADER_Z_INDEX = 201;

/**
 * 坐标头放在编辑器滚动内容里的 `.scroll-content-wrapper`（position: relative）中，用 absolute 定位：
 * - 纵向滚动由浏览器带着走，不再晚一帧；滚出编辑区的部分被滚动容器原生裁掉，不会压到窗格顶部的标签栏；
 * - absolute 不受窗格祖先 transform 影响（fixed 会以带 transform 的窗格为原点，右侧文档窗格里整体偏移）。
 * 输入仍是视口坐标，减去内容层原点即得到相对内容层、与滚动无关的位置。
 */
export interface TableColumnHeaderStyleParams {
  columnWidths: readonly number[];
  tableRect: RectMetrics;
  scrollLeft: number;
  tableScrollContainerRect: PointMetrics;
  visibleWidth: number;
  hasScrollContainer: boolean;
  /** 坐标头所在内容层在视口中的原点。 */
  layerOrigin: PointMetrics;
  /**
   * 编辑区滚动容器的上内边距。sticky 的吸附线会扣掉滚动容器的内边距，
   * 用负的 top 抵消，列标条才贴住编辑区可见区域的最上沿。
   */
  scrollPaddingTop: number;
}

export interface TableColumnHeaderStyles {
  /** 与表格等高、向上多出一条列标高度的轨道；列标条在其中 sticky，表格滚出去时随轨道一起离开。 */
  trackStyle: CSSProperties;
  floatingStyle: CSSProperties;
  scrollerStyle: CSSProperties;
}

export interface TableRowHeaderStyleParams {
  tableRect: RectMetrics;
  tableScrollContainerRect: PointMetrics;
  layerOrigin: PointMetrics;
}

function sumFiniteWidths(widths: readonly number[]): number {
  return widths.reduce((sum, width) => {
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? sum + width : sum;
  }, 0);
}

/**
 * 构造列标定位样式。只依赖父 controller 已测量出的几何数据，不直接读取 DOM。
 * 列标条在轨道里 `position: sticky; top: 0`：表格表头滚到编辑区顶部以上时贴住编辑区顶部，
 * 整张表滚出去时随轨道离开，全程由浏览器处理。横向滚动仍由 translateX 跟随表格的 scrollLeft。
 */
export function buildTableColumnHeaderStyles(
  params: TableColumnHeaderStyleParams
): TableColumnHeaderStyles {
  const totalWidth = sumFiniteWidths(params.columnWidths);

  if (!params.hasScrollContainer || totalWidth <= 0) {
    return {
      trackStyle: { visibility: 'hidden' },
      floatingStyle: {},
      scrollerStyle: {},
    };
  }

  const maxWidth = params.visibleWidth > 0 ? params.visibleWidth : params.tableRect.width;
  const containerWidth = Math.max(0, Math.min(totalWidth, maxWidth));

  return {
    trackStyle: {
      position: 'absolute',
      left: `${params.tableScrollContainerRect.left - params.layerOrigin.left}px`,
      top: `${params.tableRect.top - params.layerOrigin.top - TABLE_COLUMN_HEADER_HEIGHT}px`,
      width: `${containerWidth}px`,
      height: `${params.tableRect.height + TABLE_COLUMN_HEADER_HEIGHT}px`,
      zIndex: TABLE_COLUMN_HEADER_Z_INDEX,
      pointerEvents: 'none',
    },
    floatingStyle: {
      position: 'sticky',
      top: `${-Math.max(0, params.scrollPaddingTop)}px`,
      height: `${TABLE_COLUMN_HEADER_HEIGHT}px`,
      overflow: 'hidden',
    },
    scrollerStyle: {
      width: `${totalWidth}px`,
      transform: `translateX(-${params.scrollLeft}px)`,
    },
  };
}

/** 构造行标定位样式：贴在表格横向滚动容器左侧，随内容原生滚动、被滚动容器原生裁切。 */
export function buildTableRowHeaderStyle(params: TableRowHeaderStyleParams): CSSProperties {
  return {
    position: 'absolute',
    left: `${params.tableScrollContainerRect.left - params.layerOrigin.left - TABLE_ROW_HEADER_WIDTH}px`,
    top: `${params.tableRect.top - params.layerOrigin.top}px`,
    width: `${TABLE_ROW_HEADER_WIDTH}px`,
    height: `${Math.max(0, params.tableRect.height)}px`,
    zIndex: TABLE_ROW_HEADER_Z_INDEX,
  };
}
