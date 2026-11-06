import type { CanvasIntegrityIssue, CanvasCard } from '../../../../shared';
import type { CanvasStoredElement } from '../definitions/canvasCommit';

/** 未知卡片的线和损坏分组不能进入可绘制图，但原始行仍留在SQLite。 */
export function quarantineCanvasRelations(rows: readonly CanvasStoredElement[]) {
  const cards = new Map<string, CanvasCard>(
    rows.flatMap(row =>
      row.element.type === 'edge' ? [] : [[row.element.id, row.element] as const]
    )
  );
  const invalid = new Set<string>(),
    completed = new Set<string>();
  const issues: CanvasIntegrityIssue[] = [];
  for (const card of cards.values()) {
    if (completed.has(card.id)) continue;
    const chain = new Set<string>();
    let current: string | null = card.id;
    let bad = false;
    while (current !== null && !completed.has(current)) {
      if (chain.has(current)) {
        bad = true;
        break;
      }
      chain.add(current);
      const next = cards.get(current);
      if (!next) {
        bad = true;
        break;
      }
      current = next.parentId;
    }
    if (current !== null && invalid.has(current)) bad = true;
    for (const id of chain) {
      completed.add(id);
      if (bad) invalid.add(id);
    }
  }
  for (const id of invalid)
    if (cards.has(id))
      issues.push({
        elementId: id,
        code: 'invalid_element',
        message: '分组父卡缺失或成环，关联元素仅从显示中隔离。',
      });
  const pairs = new Set<string>();
  const visible = rows.filter(row => {
    const element = row.element;
    if (invalid.has(element.id)) return false;
    if (element.type !== 'edge') return true;
    if (
      [element.from, element.to].some(
        endpoint =>
          endpoint.kind === 'card' && (!cards.has(endpoint.cardId) || invalid.has(endpoint.cardId))
      )
    ) {
      issues.push({
        elementId: element.id,
        code: 'dangling_edge',
        message: '连线依赖不可显示的卡片，原始连线保留。',
      });
      return false;
    }
    if (element.from.kind === 'card' && element.to.kind === 'card') {
      const pair = `${element.from.cardId}:${element.to.cardId}`;
      if (element.from.cardId === element.to.cardId || pairs.has(pair)) {
        issues.push({
          elementId: element.id,
          code: 'invalid_element',
          message: '自连线或同方向重复线仅从显示中隔离。',
        });
        return false;
      }
      pairs.add(pair);
    }
    return true;
  });
  return { rows: visible, issues };
}
