import type { RenderNode } from '../../../types/render';
import { collectRenderNodeSelectionGeometries } from '../../renderNodeSelection';
import type { EditingVisualPreview } from '../definitions/editingPreviewTypes';
import { projectEditingPreviewNode } from './projectEditingPreview';

/** 点击、选框和文字输入消费与 Canvas 相同的完整节点；几何算法仍由 selection owner 持有。 */
export function collectEditingPreviewGeometries(nodes: readonly RenderNode[], previews: readonly EditingVisualPreview[]) {
  const projected = projectNodes(nodes, previews);
  return new Map(collectRenderNodeSelectionGeometries(projected, (node): node is RenderNode => true)
    .map(geometry => [geometry.elementId, geometry]));
}

function projectNodes(nodes: readonly RenderNode[], previews: readonly EditingVisualPreview[]): RenderNode[] {
  return nodes.map(node => {
    const projected = projectEditingPreviewNode(node, previews);
    return projected.kind === 'group'
      ? { ...projected, children: projectNodes(projected.children, previews) }
      : projected;
  });
}
