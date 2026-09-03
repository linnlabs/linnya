import type {
  ChartRenderNode,
  GroupRenderNode,
  ImageRenderNode,
  RenderFill,
  RenderNode,
  RenderSourceSpan,
  ShapeRenderNode,
  TableRenderNode,
  TextRenderNode,
} from '../../../types/render';
import type {
  SourceSelectableElement,
  SourceSelectionPoint,
  SourceSelectionRect,
} from '../definitions/sourceSelectionTypes';
import {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrix,
  pointInRect,
  polygonBounds,
  rectsIntersect,
  rotateMatrix,
  translateMatrix,
  type SourceSelectionMatrix,
} from './sourceSelectionGeometry';

type SourceTrackedRenderNode = RenderNode & { sourceSpan: RenderSourceSpan };

export function collectSourceSelectableElements(nodes: readonly RenderNode[]): SourceSelectableElement[] {
  const collected: SourceSelectableElement[] = [];
  collectFromNodes(nodes, identityMatrix(), [], collected);
  return collected;
}

export function findSourceElementAtPoint(
  nodes: readonly RenderNode[],
  point: SourceSelectionPoint,
): SourceSelectableElement | null {
  return findInNodes(nodes, point, identityMatrix(), []);
}

export function collectSourceElementsInRect(
  nodes: readonly RenderNode[],
  rect: SourceSelectionRect,
): SourceSelectableElement[] {
  return collectSourceSelectableElements(nodes).filter((element) =>
    rectsIntersect(rect, element.bounds),
  );
}

export function findSourceElementsByIds(
  nodes: readonly RenderNode[],
  elementIds: readonly string[],
): SourceSelectableElement[] {
  if (elementIds.length === 0) {
    return [];
  }

  const wanted = new Set(elementIds);
  return collectSourceSelectableElements(nodes).filter((element) =>
    wanted.has(element.elementId),
  );
}

function collectFromNodes(
  nodes: readonly RenderNode[],
  parentMatrix: SourceSelectionMatrix,
  parentZPath: readonly number[],
  collected: SourceSelectableElement[],
): void {
  for (const node of sortByZIndex(nodes, 'asc')) {
    if (node.visible === false) {
      continue;
    }

    const matrix = buildNodeMatrix(parentMatrix, node);
    const zPath = [...parentZPath, node.zIndex];
    if (hasSelectableSourceSpan(node)) {
      collected.push(buildSelectableElement(node, matrix, zPath));
    }

    if (node.kind === 'group') {
      collectFromNodes(node.children, matrix, zPath, collected);
    }
  }
}

function findInNodes(
  nodes: readonly RenderNode[],
  point: SourceSelectionPoint,
  parentMatrix: SourceSelectionMatrix,
  parentZPath: readonly number[],
): SourceSelectableElement | null {
  for (const node of sortByZIndex(nodes, 'desc')) {
    if (node.visible === false) {
      continue;
    }

    const matrix = buildNodeMatrix(parentMatrix, node);
    const localPoint = toLocalPoint(matrix, point);
    if (!localPoint || !pointInNodeBox(localPoint, node)) {
      continue;
    }

    const zPath = [...parentZPath, node.zIndex];
    if (node.kind === 'group') {
      const childHit = findInNodes(node.children, point, matrix, zPath);
      if (childHit) {
        return childHit;
      }
    }

    if (hasSelectableSourceSpan(node)) {
      return buildSelectableElement(node, matrix, zPath);
    }
  }

  return null;
}

function buildNodeMatrix(
  parentMatrix: SourceSelectionMatrix,
  node: RenderNode,
): SourceSelectionMatrix {
  const rotation = node.rotation ?? 0;
  return multiplyMatrix(
    multiplyMatrix(parentMatrix, translateMatrix(node.box.x, node.box.y)),
    rotateMatrix(rotation),
  );
}

function toLocalPoint(
  matrix: SourceSelectionMatrix,
  point: SourceSelectionPoint,
): SourceSelectionPoint | null {
  const inverse = invertMatrix(matrix);
  return inverse ? applyMatrix(inverse, point) : null;
}

function pointInNodeBox(point: SourceSelectionPoint, node: RenderNode): boolean {
  return pointInRect(point, {
    x: 0,
    y: 0,
    w: node.box.w,
    h: node.box.h,
  });
}

function buildSelectableElement(
  node: SourceTrackedRenderNode,
  matrix: SourceSelectionMatrix,
  zPath: readonly number[],
): SourceSelectableElement {
  const polygon = buildNodePolygon(node, matrix);
  return {
    elementId: node.id,
    kind: node.kind,
    summary: summarizeRenderNode(node),
    sourceSpan: node.sourceSpan,
    bounds: polygonBounds(polygon),
    polygon,
    zPath,
  };
}

function summarizeRenderNode(node: RenderNode): string | undefined {
  switch (node.kind) {
    case 'text':
      return summarizeTextNode(node);
    case 'shape':
      return summarizeShapeNode(node);
    case 'image':
      return summarizeImageNode(node);
    case 'svgGraphic':
      return `svgGraphic=${node.contentHash.slice(0, 12)}, fit=${node.fit}`;
    case 'formula':
      return `formula=${node.contentHash.slice(0, 12)}, align=${node.align}`;
    case 'table':
      return summarizeTableNode(node);
    case 'chart':
      return summarizeChartNode(node);
    case 'group':
      return summarizeGroupNode(node);
    default:
      return undefined;
  }
}

function summarizeTextNode(node: TextRenderNode): string | undefined {
  const text = node.paragraphs
    .flatMap((paragraph) => paragraph.runs.map((run) => 'text' in run
      ? run.text
      : `[公式:${run.projection.altText}]`))
    .join('')
    .trim();
  return text.length > 0 ? truncateSummary(`text="${text}"`) : undefined;
}

function summarizeShapeNode(node: ShapeRenderNode): string {
  const fill = summarizeFill(node.fill);
  const geometry = node.geometry.type === 'preset'
    ? node.geometry.name
    : 'path';
  return [
    `shape=${geometry}`,
    fill ? `fill=${fill}` : null,
    node.opacity !== undefined ? `opacity=${node.opacity}` : null,
  ].filter((part): part is string => part !== null).join(', ');
}

function summarizeImageNode(node: ImageRenderNode): string {
  return [
    'image',
    node.alt ? `alt="${node.alt}"` : null,
    node.fitMode ? `fit=${node.fitMode}` : null,
  ].filter((part): part is string => part !== null).join(', ');
}

function summarizeTableNode(node: TableRenderNode): string {
  return `table=${node.rows.length}x${node.columns.length}`;
}

function summarizeChartNode(node: ChartRenderNode): string {
  return `chart=${node.chartType}, series=${node.series.length}`;
}

function summarizeGroupNode(node: GroupRenderNode): string {
  return `group children=${node.children.length}`;
}

function summarizeFill(fill: RenderFill | undefined): string | undefined {
  if (!fill || fill.type === 'none') {
    return undefined;
  }
  return fill.type === 'solid' ? fill.color : 'gradient';
}

function truncateSummary(value: string): string {
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
}

function buildNodePolygon(
  node: RenderNode,
  matrix: SourceSelectionMatrix,
): readonly SourceSelectionPoint[] {
  const width = node.box.w;
  const height = node.box.h;
  return [
    applyMatrix(matrix, { x: 0, y: 0 }),
    applyMatrix(matrix, { x: width, y: 0 }),
    applyMatrix(matrix, { x: width, y: height }),
    applyMatrix(matrix, { x: 0, y: height }),
  ];
}

function hasSelectableSourceSpan(node: RenderNode): node is SourceTrackedRenderNode {
  return node.sourceSpan != null && !node.id.endsWith('-inner');
}

function sortByZIndex(
  nodes: readonly RenderNode[],
  direction: 'asc' | 'desc',
): RenderNode[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...nodes].sort((left, right) => (left.zIndex - right.zIndex) * sign);
}
