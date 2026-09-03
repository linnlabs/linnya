import type { RenderStroke, TableRenderNode, TextRenderNode } from '../../../../types/render';
import {
  TABLE_DEFAULT_BACKGROUND_FILL,
  TABLE_DEFAULT_CELL_PADDING,
  TABLE_DEFAULT_HEADER_FILL,
} from '../../../../../shared/renderModel';
import { INCHES_TO_PX } from '../../../../shared/constants';
import type { TableBorderSegment, TableCellLayout } from '../konvaTable';

export function buildTableGroupConfig(node: TableRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
}

export function buildTableBackgroundConfig(node: TableRenderNode) {
  return {
    x: 0,
    y: 0,
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    fill: node.pptxHints?.tableFill ?? TABLE_DEFAULT_BACKGROUND_FILL,
  };
}

export function buildCellRectConfig(
  node: TableRenderNode,
  layout: TableCellLayout,
) {
  // B8：默认色与 render-model（mapStructuredTableNode）/ compiler（StructuredCompiler.addTable）
  // 共享 schema 端常量，避免三端默认色漂移。
  const tableFill = node.pptxHints?.tableFill ?? TABLE_DEFAULT_BACKGROUND_FILL;
  const headerFill = node.pptxHints?.headerFill ?? TABLE_DEFAULT_HEADER_FILL;
  return {
    x: layout.x * INCHES_TO_PX,
    y: layout.y * INCHES_TO_PX,
    width: layout.width * INCHES_TO_PX,
    height: layout.height * INCHES_TO_PX,
    fill: layout.cell.fill ?? (layout.isHeader ? headerFill : tableFill),
    opacity: 1,
  };
}

export function buildCellTextNode(
  node: TableRenderNode,
  layout: TableCellLayout,
): TextRenderNode {
  if (!layout.cell.textLayout) {
    throw new Error(`Table cell ${node.id}:${layout.cell.row}:${layout.cell.col} is missing shared text layout.`);
  }
  return {
    id: `${node.id}-cell-${layout.cell.row}-${layout.cell.col}`,
    kind: 'text',
    box: {
      x: layout.x,
      y: layout.y,
      w: layout.width,
      h: layout.height,
      unit: 'in',
    },
    zIndex: node.zIndex,
    paragraphs: layout.cell.paragraphs,
    verticalAlign: layout.cell.verticalAlign ?? 'middle',
    wrap: 'word',
    overflow: 'clip',
    autoFitPolicy: 'shrink-text',
    padding: layout.cell.padding ?? TABLE_DEFAULT_CELL_PADDING,
    layout: layout.cell.textLayout,
  };
}

export function buildCellBorderConfig(segment: TableBorderSegment) {
  const paint = segment.stroke.paint;
  return {
    points: segment.points.map((value) => value * INCHES_TO_PX),
    stroke: paint.type === 'solid' ? paint.color : undefined,
    strokeWidth: normalizeStrokeWidth(segment.stroke),
    dash: resolveDashPattern(segment.stroke),
    listening: false,
  };
}

function normalizeStrokeWidth(stroke: RenderStroke): number {
  return Math.max(stroke.width, 0.75);
}

function resolveDashPattern(stroke: RenderStroke): number[] | undefined {
  switch (stroke.dash) {
    case 'dash':
      return [8, 4];
    case 'dot':
      return [2, 3];
    case 'dashDot':
      return [8, 4, 2, 4];
    default:
      return undefined;
  }
}
