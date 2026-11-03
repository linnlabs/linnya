import type { CanvasCard, CanvasLayoutDiagnostic, CanvasLayoutRequest, CanvasLayoutResult, CanvasRectangle } from '../../../../shared';
import type { CanvasLayoutAlgorithm, CanvasLayoutPosition } from '../definitions/canvasLayoutPlan';
import { resolveCanvasLayoutScope } from './resolveCanvasLayoutScope';
import { layoutCanvasGrid } from './layoutCanvasGrid';
import { layoutCanvasTree } from './layoutCanvasTree';
import { placeCanvasLayoutApart } from './placeCanvasLayoutApart';

/** 每张卡只属于一个排布组；未显式分组的选中卡形成最后一组。 */
function resolveCanvasLayoutGroups(cards: readonly CanvasCard[], requested: CanvasLayoutRequest['groups']): readonly (readonly CanvasCard[])[] {
  const assigned = new Set<string>();
  const groups: CanvasCard[][] = [];
  for (const ids of requested ?? []) {
    const keys = new Set(ids);
    const group = cards.filter(card => keys.has(card.id));
    for (const card of group) {
      if (assigned.has(card.id)) throw new Error('canvas_layout_group_overlap');
      assigned.add(card.id);
    }
    if (group.length) groups.push(group);
  }
  const rest = cards.filter(card => !assigned.has(card.id));
  if (rest.length) groups.push(rest);
  return groups;
}
export async function planCanvasLayout(request: CanvasLayoutRequest, layered: CanvasLayoutAlgorithm): Promise<CanvasLayoutResult> {
  const scope = resolveCanvasLayoutScope(request);
  const diagnostics: CanvasLayoutDiagnostic[] = [...scope.diagnostics];
  const groups = resolveCanvasLayoutGroups(scope.cards, request.groups);
  const positions: CanvasLayoutPosition[] = [], obstacles: CanvasRectangle[] = [...scope.obstacles];
  for (const cards of groups) {
    const ids = new Set(cards.map(card => card.id));
    const edges = scope.edges.filter(edge => edge.from.kind === 'card' && edge.to.kind === 'card' && ids.has(edge.from.cardId) && ids.has(edge.to.cardId));
    let local: readonly CanvasLayoutPosition[];
    if (request.algorithm === 'grid') local = layoutCanvasGrid(cards, request.columns);
    else if (request.algorithm === 'tree') {
      const tree = layoutCanvasTree(cards, edges, request.direction); local = tree.positions; diagnostics.push(...tree.diagnostics);
    } else local = await layered(cards, edges, request);
    if (local.length !== cards.length || new Set(local.map(position => position.id)).size !== cards.length || local.some(position => !ids.has(position.id))) {
      throw new Error('canvas_layout_incomplete_result');
    }
    const placed = placeCanvasLayoutApart(local, cards, obstacles, request.direction);
    const byId = new Map(cards.map(card => [card.id, card]));
    for (const position of placed) {
      const card = byId.get(position.id); if (!card) throw new Error('canvas_layout_unexpected_node');
      positions.push(position); obstacles.push({ ...position, width: card.width, height: card.height });
    }
  }
  const byId = new Map<string, CanvasCard>(scope.cards.map(card => [card.id, card]));
  const operations: CanvasLayoutResult['operations'] = positions.flatMap(position => {
    const card = byId.get(position.id); if (!card) throw new Error('canvas_layout_unexpected_node');
    return position.x === card.x && position.y === card.y ? [] : [{ op: 'update', id: card.id, baseRevision: card.revision, patch: { x: position.x, y: position.y } }];
  });
  if (!operations.length) diagnostics.push({ code: 'unchanged', elementIds: scope.cards.map(card => card.id), message: '卡片位置已经符合排布' });
  return { sequence: request.snapshot.sequence, operations, diagnostics };
}
