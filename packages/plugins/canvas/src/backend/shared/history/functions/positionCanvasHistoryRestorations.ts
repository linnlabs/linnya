import { CanvasElementSchema } from '../../../../shared';
import type { CanvasHistoryRestorationPlacementInput } from '../definitions/canvasHistoryReversal';
import { findCanvasRestorationPosition } from './findCanvasRestorationPosition';

/** 事务中间态不是障碍真源：本批稍后删除/移走的卡不能把复活卡挤离原位。 */
export function positionCanvasHistoryRestorations(input: CanvasHistoryRestorationPlacementInput) {
  const rows = new Map(input.rows), changes = [...input.changes], results = [...input.results];
  for (const [id, resultIndex] of input.restorationResults) {
    const current = rows.get(id);
    if (!current || current.element.type === 'edge') continue;
    const occupied = [...rows.values()].flatMap(row => row.element.id === id || row.element.type === 'edge' ? [] : [row.element]);
    const position = findCanvasRestorationPosition(current.element, occupied);
    if (position.x === current.element.x && position.y === current.element.y) continue;
    const after = CanvasElementSchema.parse({ ...current.element, ...position });
    rows.set(id, {
      element: after,
      fieldOrigins: { ...current.fieldOrigins, x: input.origin, y: input.origin },
      fieldVersions: { ...current.fieldVersions, x: after.revision, y: after.revision },
    });
    changes.push({ id, before: current.element, after, fields: ['x', 'y'] });
    results[resultIndex] = { ...results[resultIndex], reason: 'restored_nearby' };
  }
  return { rows, changes, results };
}
