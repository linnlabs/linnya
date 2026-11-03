import type { CanvasCard, CanvasEdge, CanvasLayoutDiagnostic, CanvasLayoutRequest } from '../../../../shared';
import type { CanvasLayoutScope } from '../definitions/canvasLayoutPlan';

export function resolveCanvasLayoutScope(request: CanvasLayoutRequest): CanvasLayoutScope {
  const all = request.snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const requested = request.elementIds?.length ? new Set(request.elementIds) : new Set(all.map(card => card.id));
  const protectedIds = new Set(request.protectedElementIds);
  const selected: CanvasCard[] = [], obstacles: CanvasCard[] = [];
  const diagnostics: CanvasLayoutDiagnostic[] = [];
  const locked: string[] = [], editing: string[] = [];
  for (const card of all) {
    if (!requested.has(card.id)) { obstacles.push(card); continue; }
    requested.delete(card.id);
    if (card.locked) { locked.push(card.id); obstacles.push(card); }
    else if (protectedIds.has(card.id)) { editing.push(card.id); obstacles.push(card); }
    else selected.push(card);
  }
  if (requested.size) diagnostics.push({ code: 'not_found', elementIds: [...requested], message: '部分待排布卡片已不存在' });
  if (locked.length) diagnostics.push({ code: 'locked', elementIds: locked, message: '锁定卡片保持原位置' });
  if (editing.length) diagnostics.push({ code: 'editing', elementIds: editing, message: '正在编辑位置或尺寸的卡片保持原位置' });
  selected.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
  const ids = new Set(selected.map(card => card.id));
  const edges = request.snapshot.elements.filter((element): element is CanvasEdge => element.type === 'edge'
    && element.from.kind === 'card' && element.to.kind === 'card' && ids.has(element.from.cardId) && ids.has(element.to.cardId));
  return { cards: selected, obstacles, edges, diagnostics };
}
