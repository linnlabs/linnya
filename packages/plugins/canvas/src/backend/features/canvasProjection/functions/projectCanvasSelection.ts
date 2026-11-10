import {
  canvasTextPrefix,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
} from '../../../../shared';
import type { CanvasCard } from '../../../../shared';
import type { CanvasSelectionProjectionInput } from '../definitions/canvasProjection';
import { projectCanvasCardBody } from './projectCanvasCardBody';

/** 按一次提交快照冻结引用；正文预算用尽后列出紧凑摘要与继续读取方法。 */
export function projectCanvasSelection(input: CanvasSelectionProjectionInput): string {
  const { snapshot, elementIds, path, context, format = 'context' } = input;
  const selected = new Set<string>(elementIds);
  const cards = orderCanvasCardsForReading(
    snapshot.elements.filter(
      (element): element is CanvasCard => element.type !== 'edge' && selected.has(element.id)
    ),
    readCanvasCardConnections(snapshot.elements)
  );
  if (format === 'markdown')
    return cards.map(card => projectCanvasCardBody(card, context)).join('\n\n');
  const lines = snapshot.elements.filter(
    element =>
      element.type === 'edge' &&
      (selected.has(element.id) ||
        (element.from.kind === 'card' &&
          selected.has(element.from.cardId) &&
          element.to.kind === 'card' &&
          selected.has(element.to.cardId)))
  );
  const header = `画布 ${path}；提交序号 ${snapshot.sequence}；所选 ${cards.length} 张卡\n`;
  const parts = [header];
  let remaining = 8000 - header.length;
  let omitted = 0;
  for (const card of cards) {
    const body = projectCanvasCardBody(card, context),
      title = `[${card.id}] ${card.type} revision=${card.revision}`;
    const complete = `\n${title}\n${body}\n`;
    const summary = `\n${title} ${canvasTextPrefix(body, 60).replace(/\n/g, ' ')}… 用 show ${card.id} 读取全文。\n`;
    const addition = complete.length <= remaining - 200 ? complete : summary;
    if (addition.length <= remaining - 200) {
      parts.push(addition);
      remaining -= addition.length;
    } else omitted++;
  }
  for (const edge of lines) {
    if (edge.type !== 'edge') continue;
    const from = edge.from.kind === 'card' ? edge.from.cardId : '悬空';
    const to = edge.to.kind === 'card' ? edge.to.cardId : '悬空';
    const direction = edge.direction === 'both' ? '↔' : edge.direction === 'none' ? '—' : '→';
    const line = `[${edge.id}] ${from} ${direction} ${to} ${edge.label}\n`;
    if (line.length <= remaining - 200) {
      parts.push(line);
      remaining -= line.length;
    } else omitted++;
  }
  if (omitted)
    parts.push(
      `\n还有 ${omitted} 项超过引用预算。使用 linnya-canvas read ${path} 和 show ${path} <卡片ID> 继续读取。`
    );
  return parts.join('');
}
