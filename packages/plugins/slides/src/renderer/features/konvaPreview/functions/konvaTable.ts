import type {
  RenderStroke,
  TableRenderNode,
} from '../../../types/render';
import {
  resolveTableCellLayouts,
  type TableCellLayout,
} from '../../../../shared/renderModel';
import { SLIDES_RENDER_COLORS } from '../../../shared/constants';

export type { TableCellLayout } from '../../../../shared/renderModel';

export interface TableBorderSegment {
  points: [number, number, number, number];
  stroke: RenderStroke;
}

const DEFAULT_STROKE: RenderStroke = {
  paint: { type: 'solid', color: SLIDES_RENDER_COLORS.tableBorderStroke },
  width: 1,
  dash: 'solid',
};

export function buildTableCellLayouts(node: TableRenderNode): TableCellLayout[] {
  return resolveTableCellLayouts(node);
}

export function buildTableBorderSegments(node: TableRenderNode): TableBorderSegment[] {
  const mergedSegments = new Map<string, TableBorderSegment>();

  for (const layout of buildTableCellLayouts(node)) {
    const { x, y, width, height, cell } = layout;
    const borders = cell.borders;
    // PPT 默认表格没有边框，只有显式设置了 borders 的 cell 才画
    if (!borders) continue;

    const sides: Array<{ stroke: RenderStroke | undefined; points: [number, number, number, number] }> = [
      { stroke: borders.top, points: [x, y, x + width, y] },
      { stroke: borders.right, points: [x + width, y, x + width, y + height] },
      { stroke: borders.bottom, points: [x, y + height, x + width, y + height] },
      { stroke: borders.left, points: [x, y, x, y + height] },
    ];

    for (const side of sides) {
      if (!side.stroke) continue;
      const segment: TableBorderSegment = { points: side.points, stroke: side.stroke };
      const key = createSegmentKey(segment.points);
      const existing = mergedSegments.get(key);
      if (existing == null) {
        mergedSegments.set(key, segment);
        continue;
      }

      mergedSegments.set(key, {
        points: existing.points,
        stroke: pickPreferredStroke(existing.stroke, segment.stroke),
      });
    }
  }

  return coalesceCollinearSegments(Array.from(mergedSegments.values()));
}

function createSegmentKey(points: [number, number, number, number]): string {
  const [x1, y1, x2, y2] = points;
  const start = `${x1},${y1}`;
  const end = `${x2},${y2}`;
  return start <= end ? `${start}|${end}` : `${end}|${start}`;
}

function pickPreferredStroke(a: RenderStroke, b: RenderStroke): RenderStroke {
  if (b.width > a.width) {
    return b;
  }
  if (a.width > b.width) {
    return a;
  }

  const aPriority = dashPriority(a.dash);
  const bPriority = dashPriority(b.dash);
  if (bPriority > aPriority) {
    return b;
  }
  return a;
}

function dashPriority(dash: RenderStroke['dash']): number {
  switch (dash) {
    case 'solid':
      return 3;
    case 'dash':
      return 2;
    case 'dashDot':
      return 1;
    case 'dot':
      return 0;
    default:
      return 3;
  }
}

function coalesceCollinearSegments(segments: readonly TableBorderSegment[]): TableBorderSegment[] {
  const groups = new Map<string, TableBorderSegment[]>();

  for (const segment of segments) {
    const groupKey = createCoalesceGroupKey(segment);
    const group = groups.get(groupKey);
    if (group == null) {
      groups.set(groupKey, [segment]);
      continue;
    }
    group.push(segment);
  }

  return Array.from(groups.values()).flatMap((group) => mergeSegmentGroup(group));
}

function createCoalesceGroupKey(segment: TableBorderSegment): string {
  const [x1, y1, , y2] = segment.points;
  const strokeKey = `${serializeStrokePaint(segment.stroke.paint)}|${segment.stroke.width}|${segment.stroke.dash ?? 'solid'}`;
  if (y1 === y2) {
    return `h|${y1}|${strokeKey}`;
  }
  return `v|${x1}|${strokeKey}`;
}

function serializeStrokePaint(paint: RenderStroke['paint']): string {
  if (paint.type === 'none') return 'none';
  if (paint.type === 'solid') return `solid:${paint.color}:${paint.opacity ?? 1}`;
  return `linear:${paint.angle}:${paint.stops
    .map((stop) => `${stop.position}:${stop.color}:${stop.opacity ?? 1}`)
    .join(',')}`;
}

function mergeSegmentGroup(group: readonly TableBorderSegment[]): TableBorderSegment[] {
  if (group.length <= 1) {
    return [...group];
  }

  const [first] = group;
  const [x1, y1, x2, y2] = first.points;
  if (y1 === y2) {
    return mergeHorizontalSegments(group);
  }
  if (x1 === x2) {
    return mergeVerticalSegments(group);
  }
  return [...group];
}

function mergeHorizontalSegments(group: readonly TableBorderSegment[]): TableBorderSegment[] {
  const sorted = [...group].sort((a, b) => a.points[0] - b.points[0]);
  const merged: TableBorderSegment[] = [];

  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last == null) {
      merged.push(segment);
      continue;
    }

    if (segment.points[0] <= last.points[2]) {
      last.points[2] = Math.max(last.points[2], segment.points[2]);
      continue;
    }

    merged.push(segment);
  }

  return merged;
}

function mergeVerticalSegments(group: readonly TableBorderSegment[]): TableBorderSegment[] {
  const sorted = [...group].sort((a, b) => a.points[1] - b.points[1]);
  const merged: TableBorderSegment[] = [];

  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last == null) {
      merged.push(segment);
      continue;
    }

    if (segment.points[1] <= last.points[3]) {
      last.points[3] = Math.max(last.points[3], segment.points[3]);
      continue;
    }

    merged.push(segment);
  }

  return merged;
}
