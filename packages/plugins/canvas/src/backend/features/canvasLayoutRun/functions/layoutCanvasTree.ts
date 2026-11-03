import type { CanvasCard, CanvasCardId, CanvasEdge, CanvasLayoutDiagnostic } from '../../../../shared';
import type { CanvasLayoutPosition } from '../definitions/canvasLayoutPlan';
import type { CanvasLayoutTree, CanvasTreeDimensions } from '../definitions/canvasLayoutTree';

/** 先到父节点成树，其余边保留在文档；迭代遍历避免长链把JS调用栈耗尽。 */
function buildCanvasTree(cards: readonly CanvasCard[], edges: readonly CanvasEdge[]): CanvasLayoutTree {
  const nodes = new Map(cards.map(card => [card.id, card]));
  const outgoing = new Map<CanvasCardId, CanvasCardId[]>(), incoming = new Set<CanvasCardId>();
  for (const edge of edges) if (edge.from.kind === 'card' && edge.to.kind === 'card') {
    const children = outgoing.get(edge.from.cardId) ?? []; children.push(edge.to.cardId); outgoing.set(edge.from.cardId, children); incoming.add(edge.to.cardId);
  }
  const children = new Map<CanvasCardId, CanvasCardId[]>(), depth = new Map<CanvasCardId, number>(), roots: CanvasCardId[] = [], order: CanvasCardId[] = [];
  const repeated = new Set<CanvasCardId>();
  const traverse = (root: CanvasCardId) => {
    if (depth.has(root)) return;
    roots.push(root); depth.set(root, 0); const queue = [root];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]; order.push(id); const accepted: CanvasCardId[] = [];
      for (const child of outgoing.get(id) ?? []) {
        if (!nodes.has(child)) continue;
        if (depth.has(child)) { repeated.add(child); continue; }
        depth.set(child, (depth.get(id) ?? 0) + 1); accepted.push(child); queue.push(child);
      }
      children.set(id, accepted);
    }
  };
  for (const card of cards) if (!incoming.has(card.id)) traverse(card.id);
  for (const card of cards) traverse(card.id);
  return { nodes, children, depth, roots, order, repeated };
}
/** 从叶到根量子树跨度；主轴每层取真实卡片尺寸的最大值。 */
function measureCanvasTree(tree: CanvasLayoutTree, direction: 'right' | 'down'): CanvasTreeDimensions {
  const { nodes, children, depth, order } = tree;
  const cross = new Map<CanvasCardId, number>(), mainSizes: number[] = [];
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index], card = nodes.get(id);
    if (!card) throw new Error('canvas_layout_node_missing');
    const descendants = children.get(id) ?? [];
    const size = descendants.reduce((sum, child) => sum + (cross.get(child) ?? 0), 0) + Math.max(0, descendants.length - 1) * 40;
    cross.set(id, Math.max(direction === 'right' ? card.height : card.width, size));
    const level = depth.get(id) ?? 0; mainSizes[level] = Math.max(mainSizes[level] ?? 0, direction === 'right' ? card.width : card.height);
  }
  let main = 0;
  const mainOffsets = mainSizes.map(size => { const value = main; main += size + 80; return value; });
  return { cross, mainOffsets };
}
function positionCanvasTree(tree: CanvasLayoutTree, dimensions: CanvasTreeDimensions, direction: 'right' | 'down'): readonly CanvasLayoutPosition[] {
  const { nodes, children, depth, roots, order } = tree, { cross, mainOffsets } = dimensions;
  let rootCross = 0;
  const starts = new Map<CanvasCardId, number>();
  for (const root of roots) { starts.set(root, rootCross); rootCross += (cross.get(root) ?? 0) + 80; }
  const positions: CanvasLayoutPosition[] = [];
  for (const id of order) {
    const card = nodes.get(id); if (!card) throw new Error('canvas_layout_node_missing');
    const span = cross.get(id) ?? 0, start = starts.get(id) ?? 0;
    const ownCross = direction === 'right' ? card.height : card.width;
    const crossPosition = start + (span - ownCross) / 2, mainPosition = mainOffsets[depth.get(id) ?? 0];
    positions.push({ id, x: direction === 'right' ? mainPosition : crossPosition, y: direction === 'right' ? crossPosition : mainPosition });
    const descendants = children.get(id) ?? [];
    const childrenSpan = descendants.reduce((sum, child) => sum + (cross.get(child) ?? 0), 0) + Math.max(0, descendants.length - 1) * 40;
    let current = start + (span - childrenSpan) / 2;
    for (const child of descendants) { starts.set(child, current); current += (cross.get(child) ?? 0) + 40; }
  }
  return positions;
}
export function layoutCanvasTree(cards: readonly CanvasCard[], edges: readonly CanvasEdge[], direction: 'right' | 'down') {
  const tree = buildCanvasTree(cards, edges), dimensions = measureCanvasTree(tree, direction), positions = positionCanvasTree(tree, dimensions, direction);
  const diagnostics: CanvasLayoutDiagnostic[] = tree.repeated.size ? [{ code: 'cycle_or_multiple_parents', elementIds: [...tree.repeated], message: '环或多父节点只取先到的父节点，其余线保持不变' }] : [];
  return { positions, diagnostics };
}
