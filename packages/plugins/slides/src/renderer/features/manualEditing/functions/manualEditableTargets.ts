import type { RenderNode, TextRenderNode } from '../../../types/render';
import {
  collectSourceSelectableElements,
  type SourceSelectionPoint,
} from '../../sourceSelection';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export function collectManualEditableTargets(nodes: readonly RenderNode[]): ManualEditableTarget[] {
  const nodesById = new Map<string, RenderNode>();
  collectNodes(nodes, nodesById);

  return collectSourceSelectableElements(nodes).flatMap((selectable) => {
    const node = nodesById.get(selectable.elementId);
    // Flex Frame 当前会投影成装饰 shape + 扁平子节点；没有完整框选几何前不开放拖动。
    if (!node?.authoringRef || node.locked === true || node.authoringRef.targetKind === 'frame') return [];
    const textContent = node.kind === 'text' ? readPlainTextContent(node) : undefined;
    return [{
      elementId: selectable.elementId,
      nodeKind: node.kind,
      targetKind: node.authoringRef.targetKind,
      authoringRef: {
        slideKey: node.authoringRef.slideKey,
        editKey: node.authoringRef.editKey,
      },
      bounds: selectable.bounds,
      polygon: selectable.polygon,
      ...(textContent !== undefined ? { textContent } : {}),
    }];
  });
}

export function findManualEditableTargetAtPoint(
  nodes: readonly RenderNode[],
  point: SourceSelectionPoint,
): ManualEditableTarget | null {
  const targets = collectManualEditableTargets(nodes);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (target && pointInPolygon(point, target.polygon)) return target;
  }
  return null;
}

function collectNodes(nodes: readonly RenderNode[], result: Map<string, RenderNode>): void {
  for (const node of nodes) {
    result.set(node.id, node);
    if (node.kind === 'group') collectNodes(node.children, result);
  }
}

/** 只有单段单 run 文本可以无损回写为完整 content；rich text 与公式保持只读。 */
function readPlainTextContent(node: TextRenderNode): string | undefined {
  if (node.paragraphs.length !== 1) return undefined;
  const runs = node.paragraphs[0]?.runs;
  if (!runs || runs.length !== 1) return undefined;
  const run = runs[0];
  return run && 'text' in run ? run.text : undefined;
}

function pointInPolygon(
  point: SourceSelectionPoint,
  polygon: readonly SourceSelectionPoint[],
): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  point: SourceSelectionPoint,
  start: SourceSelectionPoint,
  end: SourceSelectionPoint,
): boolean {
  const cross = (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y);
}
