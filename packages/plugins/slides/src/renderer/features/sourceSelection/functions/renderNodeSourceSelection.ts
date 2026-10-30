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
  rectsIntersect,
} from './sourceSelectionGeometry';
import {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
  type RenderNodeSelectionGeometry,
} from '../../renderNodeSelection';

type SourceTrackedRenderNode = RenderNode & { sourceSpan: RenderSourceSpan };

export function collectSourceSelectableElements(nodes: readonly RenderNode[]): SourceSelectableElement[] {
  return collectRenderNodeSelectionGeometries(nodes, hasSelectableSourceSpan)
    .map(buildSelectableElement);
}

export function findSourceElementAtPoint(
  nodes: readonly RenderNode[],
  point: SourceSelectionPoint,
): SourceSelectableElement | null {
  const geometry = findRenderNodeSelectionGeometryAtPoint(
    nodes,
    point,
    hasSelectableSourceSpan,
  );
  return geometry ? buildSelectableElement(geometry) : null;
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

/**
 * 画布选中的作者对象交给 AI 时的源码目标：优先对象自身的源码位置；
 * Frame 这类本身不带定位的对象，退回到它实际绘制的成员。
 */
export function findSourceElementsForSelection(
  nodes: readonly RenderNode[],
  selection: readonly { readonly elementId: string; readonly translationElementIds: readonly string[] }[],
): SourceSelectableElement[] {
  const byId = new Map(collectSourceSelectableElements(nodes).map(element => [element.elementId, element]));
  const found = selection.flatMap(target => {
    const own = byId.get(target.elementId);
    return own ? [own] : target.translationElementIds.flatMap(id => byId.get(id) ?? []);
  });
  return [...new Map(found.map(element => [element.elementId, element])).values()];
}

/** 舞台 AI 输入与 Conversation 页面上下文共用此规则，不能另读旧 UI 选区。 */
export function selectSourceTargets(input: {
  readonly nodes: readonly RenderNode[];
  readonly manualTargets: readonly { readonly elementId: string; readonly translationElementIds: readonly string[] }[];
  readonly sourceElementIds: readonly string[];
}): SourceSelectableElement[] {
  return input.manualTargets.length > 0
    ? findSourceElementsForSelection(input.nodes, input.manualTargets)
    : findSourceElementsByIds(input.nodes, input.sourceElementIds);
}

function buildSelectableElement(
  geometry: RenderNodeSelectionGeometry<SourceTrackedRenderNode>,
): SourceSelectableElement {
  const { node } = geometry;
  return {
    elementId: geometry.elementId,
    kind: node.kind,
    summary: summarizeRenderNode(node),
    sourceSpan: node.sourceSpan,
    bounds: geometry.bounds,
    polygon: geometry.polygon,
    zPath: geometry.zPath,
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

function hasSelectableSourceSpan(node: RenderNode): node is SourceTrackedRenderNode {
  return node.sourceSpan != null && !node.id.endsWith('-inner');
}
