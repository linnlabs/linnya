import { CanvasElementSchema, type CanvasElementId } from '../../../../shared';
import type {
  CanvasHistoryCreation, CanvasHistoryDeletion, CanvasHistoryEdit,
  CanvasHistoryReversalContext, CanvasHistoryReversalDecision,
} from '../definitions/canvasHistoryReversal';
import { canvasHistoryDependenciesValid, canvasHistoryElementDependsOn } from './canvasHistoryDependencies';
import { findCanvasRestorationPosition } from './findCanvasRestorationPosition';
import { restoreCanvasHistoryFields } from './restoreCanvasHistoryFields';

function claimedFields(id: CanvasElementId, context: CanvasHistoryReversalContext): readonly string[] {
  return context.claims.filter(claim => claim.elementId === id).flatMap(claim => claim.fields);
}

export function reverseCanvasHistoryCreation(
  record: CanvasHistoryCreation,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  const current = context.rows.get(record.id);
  if (!current) return { kind: 'skipped', reason: 'element_missing' };
  const foreignFields = Object.entries(current.fieldOrigins).some(([field, origin]) => origin !== record.afterOrigins[field]);
  const dependent = [...context.rows.values()].some(row => canvasHistoryElementDependsOn(row.element, record.id));
  if (claimedFields(record.id, context).length || foreignFields || dependent) {
    return { kind: 'skipped', reason: 'later_use_preserved' };
  }
  return {
    kind: 'applied', row: null, reason: null,
    deletionGuard: { origin: context.origin, revision: current.element.revision },
    change: { id: record.id, before: current.element, after: null, fields: ['$existence'] },
  };
}

export function reverseCanvasHistoryDeletion(
  record: CanvasHistoryDeletion,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  if (context.rows.has(record.id) || context.deletedOrigins[record.id]?.origin !== record.deletionOrigin) {
    return { kind: 'skipped', reason: 'later_existence_preserved' };
  }
  if (!canvasHistoryDependenciesValid(record.before, context.rows)) {
    return { kind: 'skipped', reason: 'dependency_missing' };
  }
  const revision = Math.max(record.before.revision, context.deletedOrigins[record.id]?.revision ?? 0) + 1;
  const restored = restoreCanvasHistoryFields(record.before, null, record.fields, {
    source: context.actor.source, now: context.now, revision,
  });
  const position = restored.type === 'edge' ? null : findCanvasRestorationPosition(restored,
    [...context.rows.values()].flatMap(row => row.element.type === 'edge' ? [] : [row.element]));
  const after = CanvasElementSchema.parse({ ...restored, ...position });
  const moved = after.type !== 'edge' && restored.type !== 'edge' && (after.x !== restored.x || after.y !== restored.y);
  const origins = { ...record.beforeOrigins };
  if (moved) { origins.x = context.origin; origins.y = context.origin; }
  const versions = Object.fromEntries(Object.keys(after).concat('$existence').map(field => [field, revision]));
  return {
    kind: 'applied', reason: moved ? 'restored_nearby' : null,
    row: { element: after, fieldOrigins: origins, fieldVersions: versions },
    change: { id: record.id, before: null, after, fields: Object.keys(after) },
  };
}

export function reverseCanvasHistoryEdit(
  record: CanvasHistoryEdit,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  const current = context.rows.get(record.id);
  if (!current) return { kind: 'skipped', reason: 'element_missing' };
  const claimed = claimedFields(record.id, context);
  const fields = record.fields.filter(field => !claimed.includes(field) && current.fieldOrigins[field] === record.afterOrigins[field]);
  if (!fields.length) return { kind: 'skipped', reason: 'later_fields_preserved' };
  const after = restoreCanvasHistoryFields(record.before, current.element, fields, {
    source: context.actor.source, now: context.now, revision: current.element.revision + 1,
  });
  if (!canvasHistoryDependenciesValid(after, context.rows)) {
    return { kind: 'skipped', reason: 'dependency_missing' };
  }
  const origins = { ...current.fieldOrigins };
  const versions = { ...current.fieldVersions };
  // 逻辑来源回到被恢复的写入；版本仍单调增加，旧Agent不能因此重新获准覆盖。
  for (const field of fields) {
    origins[field] = record.beforeOrigins[field] ?? 'baseline';
    versions[field] = after.revision;
  }
  return {
    kind: 'applied', reason: fields.length === record.fields.length ? null : 'later_fields_preserved',
    row: { element: after, fieldOrigins: origins, fieldVersions: versions },
    change: { id: record.id, before: current.element, after, fields },
  };
}
