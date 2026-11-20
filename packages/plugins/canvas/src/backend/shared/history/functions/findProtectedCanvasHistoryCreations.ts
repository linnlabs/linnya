import type { CanvasElementId } from '../../../../shared';
import type { CanvasStoredElement } from '../../../features/canvasCommit';
import type { CanvasHistoryChange } from '../definitions/canvasHistory';
import { canvasHistoryElementDependsOn } from './canvasHistoryDependencies';

function hasForeignEarlierFields(
  id: CanvasElementId,
  records: readonly CanvasHistoryChange[],
  allowedOrigins: ReadonlySet<string>
): boolean {
  return records.some(
    record =>
      record.id === id &&
      record.before &&
      record.fields.some(
        field => record.beforeOrigins[field] && !allowedOrigins.has(record.beforeOrigins[field])
      )
  );
}

/**
 * 依赖由同一条记录建立（例如“放进新分区”把成员归入新分区），且之后没被别人改写时，
 * 撤销会先恢复成员归属，不能当作外部使用；实际是否还有依赖由撤回新建时按当时状态复核。
 */
function dependencyFromSameEntry(
  row: CanvasStoredElement,
  id: CanvasElementId,
  records: readonly CanvasHistoryChange[]
): boolean {
  return records.some(
    record =>
      record.id === row.element.id &&
      record.after !== null &&
      record.fields.includes('parentId') &&
      canvasHistoryElementDependsOn(record.after, id) &&
      !(record.before && canvasHistoryElementDependsOn(record.before, id)) &&
      row.fieldOrigins.parentId === record.afterOrigins.parentId
  );
}

export function findProtectedCanvasHistoryCreations(
  records: readonly CanvasHistoryChange[],
  rows: ReadonlyMap<CanvasElementId, CanvasStoredElement>
): ReadonlySet<CanvasElementId> {
  const creationIds = new Set(
    records.filter(record => !record.before && record.after).map(record => record.id)
  );
  const allowedOrigins = new Set(
    records.flatMap(record => record.fields.map(field => record.afterOrigins[field]))
  );
  const protectedIds = new Set<CanvasElementId>();
  for (const id of creationIds) {
    const current = rows.get(id);
    const foreignFields =
      current && Object.values(current.fieldOrigins).some(origin => !allowedOrigins.has(origin));
    const externalDependency = [...rows.values()].some(
      row =>
        canvasHistoryElementDependsOn(row.element, id) &&
        !creationIds.has(row.element.id) &&
        !dependencyFromSameEntry(row, id, records)
    );
    if (
      !current ||
      foreignFields ||
      externalDependency ||
      hasForeignEarlierFields(id, records, allowedOrigins)
    ) {
      protectedIds.add(id);
    }
  }
  // 整组撤回前求依赖闭包：新卡一旦被别人使用，连同其依赖的新卡都保留全部字段。
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const id of creationIds) {
      if (protectedIds.has(id)) continue;
      const protectedDependency = [...rows.values()].some(
        row => canvasHistoryElementDependsOn(row.element, id) && protectedIds.has(row.element.id)
      );
      if (protectedDependency) {
        protectedIds.add(id);
        expanded = true;
      }
    }
  }
  return protectedIds;
}
