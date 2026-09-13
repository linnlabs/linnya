import type { RenderNode } from '../../../types/render';
import {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
  type RenderNodeSelectionGeometry,
  type RenderNodeSelectionPoint,
} from '../../renderNodeSelection';
import { createTextEditingTarget } from '../../textEditing';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export function collectManualEditableTargets(nodes: readonly RenderNode[]): ManualEditableTarget[] {
  return collectRenderNodeSelectionGeometries(nodes, isManualEditableNode)
    .map(geometry => buildManualEditableTarget(nodes, geometry));
}

export function findManualEditableTargetAtPoint(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
): ManualEditableTarget | null {
  const geometry = findRenderNodeSelectionGeometryAtPoint(nodes, point, isManualEditableNode);
  if (!geometry) return null;
  return buildManualEditableTarget(nodes, geometry);
}

function buildManualEditableTarget(
  nodes: readonly RenderNode[],
  geometry: RenderNodeSelectionGeometry<RenderNode & {
    authoringRef: NonNullable<RenderNode['authoringRef']>;
    authoringEdit: NonNullable<RenderNode['authoringEdit']>;
  }>,
): ManualEditableTarget {
  const { node } = geometry;
  const textEditing = createTextEditingTarget(geometry);
  return {
    elementId: geometry.elementId,
    nodeKind: geometry.nodeKind,
    targetKind: node.authoringRef.targetKind,
    authoringRef: {
      slideKey: node.authoringRef.slideKey,
      editKey: node.authoringRef.editKey,
    },
    bounds: geometry.bounds,
    polygon: geometry.polygon,
    translationElementIds: node.authoringRef.targetKind === 'frame'
      ? collectFrameTranslationRoots(nodes, node.authoringRef)
      : [geometry.elementId],
    ...(textEditing ? { textEditing } : {}),
  };
}

/**
 * Frame 在 RenderModel 中仍是摊平节点。这里仅消费编译器投影的作者层级，
 * 并返回最外层渲染根，避免 Group 与 child 同时平移造成双重位移。
 */
function collectFrameTranslationRoots(
  nodes: readonly RenderNode[],
  frameRef: NonNullable<RenderNode['authoringRef']>,
): string[] {
  const roots: string[] = [];
  visit(nodes);
  return roots;

  function visit(currentNodes: readonly RenderNode[]): void {
    for (const node of currentNodes) {
      if (belongsToFrame(node, frameRef)) {
        roots.push(node.id);
        continue;
      }
      if (node.kind === 'group') visit(node.children);
    }
  }
}

function belongsToFrame(
  node: RenderNode,
  frameRef: NonNullable<RenderNode['authoringRef']>,
): boolean {
  return isSameAuthoringObject(node.authoringRef, frameRef)
    || node.authoringAncestorRefs?.some(ref => isSameAuthoringObject(ref, frameRef)) === true;
}

function isSameAuthoringObject(
  left: RenderNode['authoringRef'],
  right: NonNullable<RenderNode['authoringRef']>,
): boolean {
  return left?.slideKey === right.slideKey && left.editKey === right.editKey;
}

function isManualEditableNode(node: RenderNode): node is RenderNode & {
  authoringRef: NonNullable<RenderNode['authoringRef']>;
  authoringEdit: NonNullable<RenderNode['authoringEdit']>;
} {
  return node.authoringRef !== undefined
    && node.authoringEdit !== undefined
    && node.authoringEdit.capabilities.length > 0
    && node.locked !== true
    && !node.id.endsWith('-inner');
}
