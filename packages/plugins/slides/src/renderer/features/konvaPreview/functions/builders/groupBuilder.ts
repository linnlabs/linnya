import type { GroupRenderNode, RenderNode } from '../../../../types/render';
import { INCHES_TO_PX } from '../../../../shared/constants';

export function buildGroupConfig(node: GroupRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
}

export function sortNodesByZIndex<T extends { zIndex: number }>(nodes: readonly T[]): T[] {
  return [...nodes].sort((left, right) => left.zIndex - right.zIndex);
}

export function flattenRenderableNodes(nodes: readonly RenderNode[]): RenderNode[] {
  const flattened: RenderNode[] = [];
  for (const node of sortNodesByZIndex(nodes)) {
    if (node.visible === false) {
      continue;
    }
    if (node.kind === 'group') {
      flattened.push(...flattenRenderableNodes(node.children));
      continue;
    }
    flattened.push(node);
  }
  return flattened;
}
