import type { OverlapClassification, SpatialBox } from '@plugin/slides/shared';

export interface SpatialComparable {
  nodeId?: string;
  parentNodeId?: string;
  kind: string;
  box: SpatialBox;
  zIndex?: number;
  opacity?: number;
  semanticRole?: string;
  /** 由整页关系预计算；表示小型 Shape 与明确细线相交。 */
  isLineNode?: boolean;
}

export function intersectionBox(
  left: SpatialBox,
  right: SpatialBox,
): SpatialBox | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.min(left.y + left.h, right.y + right.h);
  const w = rightEdge - x;
  const h = bottomEdge - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

export function intersectionArea(left: SpatialBox, right: SpatialBox): number {
  const intersection = intersectionBox(left, right);
  return intersection ? intersection.w * intersection.h : 0;
}

/**
 * 返回相交面积占较小矩形的比例。
 *
 * 几何上该值不会大于 1，但浮点加减可能让完全覆盖得到
 * `1.0000000000000002`。在唯一几何生产端收敛该误差，避免合法事实进入
 * strict diagnostic schema 时被误判为合同损坏。
 */
export function smallerBoxCoveredRatio(left: SpatialBox, right: SpatialBox): number {
  const smallerArea = Math.min(boxArea(left), boxArea(right));
  if (smallerArea <= 0) return 0;
  return Math.min(1, intersectionArea(left, right) / smallerArea);
}

export function containsWithPadding(outer: SpatialBox, inner: SpatialBox, padding: number): boolean {
  return inner.x >= outer.x + padding
    && inner.y >= outer.y + padding
    && inner.x + inner.w <= outer.x + outer.w - padding
    && inner.y + inner.h <= outer.y + outer.h - padding;
}

export function isThinDecorativeShape(position: SpatialBox): boolean {
  return position.w <= 0.12 || position.h <= 0.12;
}

function boxArea(box: SpatialBox): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function normalizedRole(role: string | undefined): string {
  return role?.trim().toLowerCase() ?? '';
}

function hasRole(node: SpatialComparable, roles: ReadonlySet<string>): boolean {
  return roles.has(normalizedRole(node.semanticRole));
}

const BACKGROUND_ROLES = new Set(['background', 'backdrop']);
const OVERLAY_ROLES = new Set(['annotation', 'mask', 'overlay', 'scrim']);
const DECORATIVE_ROLES = new Set(['decoration', 'decorative', 'divider']);
const PRIMARY_VISUAL_ROLES = new Set(['primary-visual']);
const MAX_LINE_NODE_SIZE = 0.4;

function isDirectParentChild(left: SpatialComparable, right: SpatialComparable): boolean {
  return (left.nodeId != null && left.nodeId === right.parentNodeId)
    || (right.nodeId != null && right.nodeId === left.parentNodeId);
}

function isSameExplicitComponent(left: SpatialComparable, right: SpatialComparable): boolean {
  const parentNodeId = left.parentNodeId;
  return parentNodeId != null
    && parentNodeId === right.parentNodeId
    && !parentNodeId.startsWith('slide:');
}

function isLineNodeMarker(
  candidate: SpatialComparable,
  nodes: readonly SpatialComparable[],
): boolean {
  if (
    candidate.kind !== 'shape'
    || isThinDecorativeShape(candidate.box)
    || candidate.box.w > MAX_LINE_NODE_SIZE
    || candidate.box.h > MAX_LINE_NODE_SIZE
  ) {
    return false;
  }
  return nodes.some((node) =>
    node !== candidate
    && node.kind === 'shape'
    && isThinDecorativeShape(node.box)
    && intersectionArea(candidate.box, node.box) > 0,
  );
}

/**
 * 线—节点语义依赖整页邻接关系，先在边界统一标注，再交给 pairwise classifier。
 */
export function annotateLineNodeSemantics<T extends SpatialComparable>(
  nodes: readonly T[],
): Array<T & { isLineNode: boolean }> {
  return nodes.map((node) => ({
    ...node,
    isLineNode: isLineNodeMarker(node, nodes),
  }));
}

function orderByZIndex(
  left: SpatialComparable,
  right: SpatialComparable,
): { lower: SpatialComparable; upper: SpatialComparable } | undefined {
  if (left.zIndex == null || right.zIndex == null || left.zIndex === right.zIndex) {
    return undefined;
  }
  return left.zIndex < right.zIndex
    ? { lower: left, upper: right }
    : { lower: right, upper: left };
}

function isSemanticOverlay(lower: SpatialComparable, upper: SpatialComparable): boolean {
  return hasRole(upper, OVERLAY_ROLES)
    && (lower.kind === 'image' || hasRole(lower, PRIMARY_VISUAL_ROLES));
}

function isTranslucentVisualOverlay(lower: SpatialComparable, upper: SpatialComparable): boolean {
  if (upper.kind !== 'shape' || (lower.kind !== 'image' && lower.kind !== 'shape')) {
    return false;
  }
  if (upper.opacity == null || upper.opacity <= 0.05 || upper.opacity >= 0.95) {
    return false;
  }
  return smallerBoxCoveredRatio(lower.box, upper.box) >= 0.8;
}

function isBackgroundCarrier(lower: SpatialComparable, upper: SpatialComparable): boolean {
  if (!containsWithPadding(lower.box, upper.box, -0.04)) {
    return false;
  }
  const upperArea = boxArea(upper.box);
  if (upperArea <= 0) {
    return false;
  }
  return hasRole(lower, BACKGROUND_ROLES)
    || (lower.kind === 'image' && boxArea(lower.box) / upperArea >= 4);
}

function isChartPanelCarrier(lower: SpatialComparable, upper: SpatialComparable): boolean {
  return lower.kind === 'shape'
    && upper.kind === 'chart'
    && containsWithPadding(lower.box, upper.box, -0.04);
}

export function classifyOverlap(
  left: SpatialComparable,
  right: SpatialComparable,
): OverlapClassification {
  if (intersectionArea(left.box, right.box) <= 0) {
    return 'none';
  }

  if (isDirectParentChild(left, right)) {
    return 'container';
  }

  if (
    isSameExplicitComponent(left, right)
    && (left.kind === 'shape' || right.kind === 'shape')
  ) {
    return 'container';
  }

  if (hasRole(left, DECORATIVE_ROLES) || hasRole(right, DECORATIVE_ROLES)) {
    return 'decorative';
  }

  if (left.isLineNode || right.isLineNode) {
    return 'decorative';
  }

  const layerOrder = orderByZIndex(left, right);
  if (layerOrder) {
    if (isChartPanelCarrier(layerOrder.lower, layerOrder.upper)) {
      return 'container';
    }
    if (
      isSemanticOverlay(layerOrder.lower, layerOrder.upper)
      || isTranslucentVisualOverlay(layerOrder.lower, layerOrder.upper)
    ) {
      return 'overlay';
    }
    if (isBackgroundCarrier(layerOrder.lower, layerOrder.upper)) {
      return 'background';
    }
  }

  const pair: Array<[SpatialComparable, SpatialComparable]> = [
    [left, right],
    [right, left],
  ];

  for (const [shapeLike, textLike] of pair) {
    if (shapeLike.kind !== 'shape' || textLike.kind !== 'text') {
      continue;
    }
    if (isThinDecorativeShape(shapeLike.box)) {
      return 'decorative';
    }
    if (containsWithPadding(shapeLike.box, textLike.box, -0.04)) {
      return 'container';
    }
  }

  if (left.kind === 'shape' && right.kind === 'shape') {
    if (containsWithPadding(left.box, right.box, -0.02) || containsWithPadding(right.box, left.box, -0.02)) {
      return 'container';
    }
  }

  if (left.kind === 'text' && right.kind === 'text') {
    const sameAnchor = Math.abs(left.box.x - right.box.x) <= 0.02
      && Math.abs(left.box.y - right.box.y) <= 0.02
      && Math.abs(left.box.w - right.box.w) <= 0.05;
    if (
      sameAnchor
      && (containsWithPadding(left.box, right.box, -0.02) || containsWithPadding(right.box, left.box, -0.02))
    ) {
      return 'container';
    }
  }

  if (isThinDecorativeShape(left.box) || isThinDecorativeShape(right.box)) {
    return 'decorative';
  }

  return 'forbidden';
}


/** 显式背景/装饰语义在所有空间规则中使用相同口径。 */
export function hasDecorativeRole(role: string | undefined): boolean {
  const normalized = normalizedRole(role);
  return BACKGROUND_ROLES.has(normalized) || DECORATIVE_ROLES.has(normalized);
}

export function isChromeTextRole(role: string | undefined): boolean {
  return role === 'footnote' || role === 'source' || role === 'page-number';
}
