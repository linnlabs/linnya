import type { RenderNode } from '../../../types/render';
import {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
  type RenderNodeSelectionPoint,
} from '../../renderNodeSelection';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export function collectManualEditableTargets(nodes: readonly RenderNode[]): ManualEditableTarget[] {
  return collectRenderNodeSelectionGeometries(nodes, isManualEditableNode).map((geometry) => {
    const { node } = geometry;
    const text = node.authoringEdit?.text;
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
      ...(text?.kind === 'plain_text' ? { textContent: text.content } : {}),
    };
  });
}

export function findManualEditableTargetAtPoint(
  nodes: readonly RenderNode[],
  point: RenderNodeSelectionPoint,
): ManualEditableTarget | null {
  const geometry = findRenderNodeSelectionGeometryAtPoint(nodes, point, isManualEditableNode);
  if (!geometry) return null;
  const { node } = geometry;
  const text = node.authoringEdit?.text;
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
    ...(text?.kind === 'plain_text' ? { textContent: text.content } : {}),
  };
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
