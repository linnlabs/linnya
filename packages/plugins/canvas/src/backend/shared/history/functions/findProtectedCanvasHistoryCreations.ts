import type { CanvasElementId } from '../../../../shared';
import type { CanvasStoredElement } from '../../../features/canvasCommit';
import type { CanvasHistoryChange } from '../definitions/canvasHistory';
import { canvasHistoryElementDependsOn } from './canvasHistoryDependencies';

function hasForeignEarlierFields(
  id: CanvasElementId,
  records: readonly CanvasHistoryChange[],
  allowedOrigins: ReadonlySet<string>
): boolean {
  return records.some(record => record.id === id && record.before && record.fields.some(field =>
    record.beforeOrigins[field] && !allowedOrigins.has(record.beforeOrigins[field])));
}

export function findProtectedCanvasHistoryCreations(
  records: readonly CanvasHistoryChange[],
  rows: ReadonlyMap<CanvasElementId, CanvasStoredElement>
): ReadonlySet<CanvasElementId> {
  const creationIds = new Set(records.filter(record => !record.before && record.after).map(record => record.id));
  const allowedOrigins = new Set(records.flatMap(record => record.fields.map(field => record.afterOrigins[field])));
  const protectedIds = new Set<CanvasElementId>();
  for (const id of creationIds) {
    const current = rows.get(id);
    const foreignFields = current && Object.values(current.fieldOrigins).some(origin => !allowedOrigins.has(origin));
    const externalDependency = [...rows.values()].some(row =>
      canvasHistoryElementDependsOn(row.element, id) && !creationIds.has(row.element.id));
    if (!current || foreignFields || externalDependency || hasForeignEarlierFields(id, records, allowedOrigins)) {
      protectedIds.add(id);
    }
  }
  // 整组撤回前求依赖闭包：新卡一旦被别人使用，连同其依赖的新卡都保留全部字段。
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const id of creationIds) {
      if (protectedIds.has(id)) continue;
      const protectedDependency = [...rows.values()].some(row =>
        canvasHistoryElementDependsOn(row.element, id) && protectedIds.has(row.element.id));
      if (protectedDependency) {
        protectedIds.add(id);
        expanded = true;
      }
    }
  }
  return protectedIds;
}
