import type { RenderNode } from '../../../types/render';
import type {
  RenderNodeSelectionGeometry,
  RenderNodeSelectionPoint,
} from '../definitions/renderNodeSelectionTypes';
import {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrix,
  pointInRect,
  polygonBounds,
  rotateMatrix,
  translateMatrix,
  type RenderNodeSelectionMatrix,
} from './selectionGeometry';

export type RenderNodeSelectionPredicate<TNode extends RenderNode> = (
  node: RenderNode,
) => node is TNode;

export function collectRenderNodeSelectionGeometries<TNode extends RenderNode>(
  nodes: readonly RenderNode[],
  predicate: RenderNodeSelectionPredicate<TNode>,
): RenderNodeSelectionGeometry<TNode>[] {
  const collected: RenderNodeSelectionGeometry<TNode>[] = [];
  collectFromNodes(nodes, identityMatrix(), [], predicate, collected);
  return collected;
}

export function findRenderNodeSelectionGeometryAtPoint<TNode extends RenderNode>(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
  predicate: RenderNodeSelectionPredicate<TNode>,
): RenderNodeSelectionGeometry<TNode> | null {
  return findInNodes(nodes, point, identityMatrix(), [], predicate);
}

function collectFromNodes<TNode extends RenderNode>(
  nodes: readonly RenderNode[],
  parentMatrix: RenderNodeSelectionMatrix,
  parentZPath: readonly number[],
  predicate: RenderNodeSelectionPredicate<TNode>,
  collected: RenderNodeSelectionGeometry<TNode>[],
): void {
  for (const node of sortByZIndex(nodes, 'asc')) {
    if (node.visible === false) continue;
    const matrix = buildNodeMatrix(parentMatrix, node);
    const zPath = [...parentZPath, node.zIndex];
    if (predicate(node)) collected.push(buildGeometry(node, matrix, zPath));
    if (node.kind === 'group') {
      collectFromNodes(node.children, matrix, zPath, predicate, collected);
    }
  }
}

function findInNodes<TNode extends RenderNode>(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
  parentMatrix: RenderNodeSelectionMatrix,
  parentZPath: readonly number[],
  predicate: RenderNodeSelectionPredicate<TNode>,
): RenderNodeSelectionGeometry<TNode> | null {
  for (const node of sortByZIndex(nodes, 'desc')) {
    if (node.visible === false) continue;
    const matrix = buildNodeMatrix(parentMatrix, node);
    const localPoint = toLocalPoint(matrix, point);
    if (!localPoint || !pointInRect(localPoint, { x: 0, y: 0, w: node.box.w, h: node.box.h })) {
      continue;
    }
    const zPath = [...parentZPath, node.zIndex];
    if (node.kind === 'group') {
      const child = findInNodes(node.children, point, matrix, zPath, predicate);
      if (child) return child;
    }
    if (predicate(node)) return buildGeometry(node, matrix, zPath);
  }
  return null;
}

function buildGeometry<TNode extends RenderNode>(
  node: TNode,
  matrix: RenderNodeSelectionMatrix,
  zPath: readonly number[],
): RenderNodeSelectionGeometry<TNode> {
  const polygon = [
    applyMatrix(matrix, { x: 0, y: 0 }),
    applyMatrix(matrix, { x: node.box.w, y: 0 }),
    applyMatrix(matrix, { x: node.box.w, y: node.box.h }),
    applyMatrix(matrix, { x: 0, y: node.box.h }),
  ];
  return {
    elementId: node.id,
    nodeKind: node.kind,
    node,
    bounds: polygonBounds(polygon),
    polygon,
    zPath,
  };
}

function buildNodeMatrix(
  parentMatrix: RenderNodeSelectionMatrix,
  node: RenderNode,
): RenderNodeSelectionMatrix {
  return multiplyMatrix(
    multiplyMatrix(parentMatrix, translateMatrix(node.box.x, node.box.y)),
    rotateMatrix(node.rotation ?? 0),
  );
}

function toLocalPoint(
  matrix: RenderNodeSelectionMatrix,
  point: RenderNodeSelectionPoint,
): RenderNodeSelectionPoint | null {
  const inverse = invertMatrix(matrix);
  return inverse ? applyMatrix(inverse, point) : null;
}

function sortByZIndex(nodes: readonly RenderNode[], direction: 'asc' | 'desc'): RenderNode[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...nodes].sort((left, right) => (left.zIndex - right.zIndex) * sign);
}
