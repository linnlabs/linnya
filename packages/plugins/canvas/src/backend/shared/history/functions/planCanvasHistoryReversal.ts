import { CanvasElementSchema, type CanvasElement, type CanvasElementId, type CanvasSource } from '../../../../shared';
import type { CanvasCommitActor, CanvasCommitPlan, CanvasCommitState, CanvasEditingClaim, CanvasElementChange } from '../../../features/canvasCommit';
import { validateCanvasGraph } from '../../../features/canvasCommit';
import { findCanvasRestorationPosition } from './findCanvasRestorationPosition';
import { canvasHistoryDependenciesValid } from './canvasHistoryDependencies';
import type { CanvasHistoryChange, CanvasHistoryEntry } from '../definitions/canvasHistory';

function dependsOn(element: CanvasElement, id: CanvasElementId): boolean {
  return element.type === 'edge' ? [element.from, element.to].some(endpoint => endpoint.kind === 'card' && endpoint.cardId === id) : element.parentId === id;
}
function restoredElement(before: CanvasElement, current: CanvasElement | null, fields: readonly string[], source: CanvasSource, now: number, revision: number): CanvasElement {
  const patch: Record<string, unknown> = {};
  for (const field of fields) if (field !== '$existence') patch[field] = Reflect.get(before, field);
  return CanvasElementSchema.parse({ ...(current ?? before), ...patch, revision, updatedBy: source, updatedAt: now });
}

export function planCanvasHistoryReversal(input: { readonly state: CanvasCommitState; readonly entry: CanvasHistoryEntry; readonly actor: CanvasCommitActor; readonly claims: readonly CanvasEditingClaim[]; readonly origin: string; readonly now: number }): CanvasCommitPlan {
  const rows = new Map(input.state.elements.map(row => [row.element.id, row]));
  const deleted = { ...input.state.deletedOrigins };
  const changes: CanvasElementChange[] = [];
  const results: CanvasCommitPlan['results'] = [];
  const records = [...input.entry.changes].reverse();
  const creationIds = new Set(records.filter(record => !record.before && record.after).map(record => record.id));
  const allowedOrigins = new Set(records.flatMap(record => record.fields.map(field => record.afterOrigins[field])));
  const protectedCreations = new Set<CanvasElementId>();
  for (const id of creationIds) {
    const current = rows.get(id);
    if (!current || Object.values(current.fieldOrigins).some(origin => !allowedOrigins.has(origin)) || records.some(record => record.id === id && record.before && record.fields.some(field => record.beforeOrigins[field] && !allowedOrigins.has(record.beforeOrigins[field]))) || [...rows.values()].some(row => dependsOn(row.element, id) && !creationIds.has(row.element.id))) protectedCreations.add(id);
  }
  // 若新卡已被别人使用，其所有字段原样保留，不先撤一部分再发现不能删除。
  let expanded = true;
  while (expanded) { expanded = false; for (const id of creationIds) if (!protectedCreations.has(id) && [...rows.values()].some(row => dependsOn(row.element, id) && protectedCreations.has(row.element.id))) { protectedCreations.add(id); expanded = true; } }
  function report(record: CanvasHistoryChange, status: 'applied' | 'skipped', reason: string | null) { results.push({ index: results.length, id: record.id, status, reason }); }
  function protectedFields(id: CanvasElementId) { return input.claims.filter(claim => claim.elementId === id).flatMap(claim => claim.fields); }
  function apply(record: CanvasHistoryChange): void {
    const current = rows.get(record.id);
    if (protectedCreations.has(record.id)) { report(record, 'skipped', 'later_use_preserved'); return; }
    if (!record.before && record.after) {
      if (!current) { report(record, 'skipped', 'element_missing'); return; }
      if (protectedFields(record.id).length || Object.entries(current.fieldOrigins).some(([field, origin]) => origin !== record.afterOrigins[field]) || [...rows.values()].some(row => dependsOn(row.element, record.id))) { report(record, 'skipped', 'later_use_preserved'); return; }
      changes.push({ id: record.id, before: current.element, after: null, fields: ['$existence'] });
      deleted[record.id] = { origin: input.origin, revision: current.element.revision };
      rows.delete(record.id); report(record, 'applied', null); return;
    }
    if (record.before && !record.after) {
      if (current || deleted[record.id]?.origin !== record.deletionOrigin) { report(record, 'skipped', 'later_existence_preserved'); return; }
      if (!canvasHistoryDependenciesValid(record.before, rows)) { report(record, 'skipped', 'dependency_missing'); return; }
      const revision = Math.max(record.before.revision, deleted[record.id]?.revision ?? 0) + 1;
      const restored = restoredElement(record.before, null, record.fields, input.actor.source, input.now, revision);
      const position = restored.type === 'edge' ? null : findCanvasRestorationPosition(restored, [...rows.values()].flatMap(row => row.element.type === 'edge' ? [] : [row.element]));
      const after = CanvasElementSchema.parse({ ...restored, ...position });
      const moved = after.type !== 'edge' && restored.type !== 'edge' && (after.x !== restored.x || after.y !== restored.y);
      const origins = { ...record.beforeOrigins };
      if (moved) { origins.x = input.origin; origins.y = input.origin; }
      const versions = Object.fromEntries(Object.keys(after).concat('$existence').map(field => [field, revision]));
      rows.set(record.id, { element: after, fieldOrigins: origins, fieldVersions: versions });
      changes.push({ id: record.id, before: null, after, fields: Object.keys(after) }); report(record, 'applied', moved ? 'restored_nearby' : null); return;
    }
    if (!record.before || !record.after || !current) { report(record, 'skipped', 'element_missing'); return; }
    const claimed = protectedFields(record.id);
    const fields = record.fields.filter(field => !claimed.includes(field) && current.fieldOrigins[field] === record.afterOrigins[field]);
    if (!fields.length) { report(record, 'skipped', 'later_fields_preserved'); return; }
    const after = restoredElement(record.before, current.element, fields, input.actor.source, input.now, current.element.revision + 1);
    if (!canvasHistoryDependenciesValid(after, rows)) { report(record, 'skipped', 'dependency_missing'); return; }
    const origins = { ...current.fieldOrigins }; const versions = { ...current.fieldVersions };
    for (const field of fields) { origins[field] = record.beforeOrigins[field] ?? 'baseline'; versions[field] = after.revision; }
    rows.set(record.id, { element: after, fieldOrigins: origins, fieldVersions: versions });
    changes.push({ id: record.id, before: current.element, after, fields }); report(record, 'applied', fields.length === record.fields.length ? null : 'later_fields_preserved');
  }
  // 先撤自己的新线，再撤新卡；恢复时先卡后线，避免级联吞掉别人的连接。
  const creations = records.filter(record => !record.before && record.after);
  for (const record of creations.filter(record => record.after?.type === 'edge')) apply(record);
  for (const record of records.filter(record => record.before && !record.after && record.before.type !== 'edge')) apply(record);
  for (const record of records.filter(record => record.before && record.after)) apply(record);
  for (const record of creations.filter(record => record.after?.type !== 'edge')) apply(record);
  for (const record of records.filter(record => record.before && !record.after && record.before.type === 'edge')) apply(record);
  validateCanvasGraph([...rows.values()].map(row => row.element));
  return { origin: input.origin, changes, results, refs: {}, state: { ...input.state, deletedOrigins: deleted, sequence: input.state.sequence + (changes.length ? 1 : 0), elements: [...rows.values()] } };
}
