import type { CanvasElementId } from '../../../../shared';
import type {
  CanvasHistoryCreation,
  CanvasHistoryDeletion,
  CanvasHistoryEdit,
  CanvasHistoryReversalContext,
  CanvasHistoryReversalDecision,
} from '../definitions/canvasHistoryReversal';
import {
  canvasHistoryDependenciesValid,
  canvasHistoryElementDependsOn,
} from './canvasHistoryDependencies';
import {
  planCanvasHistoryEditFields,
  canvasHistoryFieldResultReason,
} from './planCanvasHistoryEditFields';
import { restoreCanvasHistoryFields } from './restoreCanvasHistoryFields';

function claimedFields(
  id: CanvasElementId,
  context: CanvasHistoryReversalContext
): readonly string[] {
  return context.claims.filter(claim => claim.elementId === id).flatMap(claim => claim.fields);
}

export function reverseCanvasHistoryCreation(
  record: CanvasHistoryCreation,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  const current = context.rows.get(record.id);
  if (!current) return { kind: 'skipped', reason: 'element_missing' };
  const foreignFields = Object.entries(current.fieldOrigins).some(
    ([field, origin]) => origin !== record.afterOrigins[field]
  );
  const dependent = [...context.rows.values()].some(row =>
    canvasHistoryElementDependsOn(row.element, record.id)
  );
  if (claimedFields(record.id, context).length || foreignFields || dependent) {
    return { kind: 'skipped', reason: 'later_use_preserved' };
  }
  return {
    kind: 'applied',
    row: null,
    reason: null,
    deletionGuard: { origin: context.origin, revision: current.element.revision },
    change: { id: record.id, before: current.element, after: null, fields: ['$existence'] },
  };
}

export function reverseCanvasHistoryDeletion(
  record: CanvasHistoryDeletion,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  if (
    context.rows.has(record.id) ||
    context.deletedOrigins[record.id]?.origin !== record.deletionOrigin
  ) {
    return { kind: 'skipped', reason: 'later_existence_preserved' };
  }
  if (!canvasHistoryDependenciesValid(record.before, context.rows)) {
    return { kind: 'skipped', reason: 'dependency_missing' };
  }
  const revision =
    Math.max(record.before.revision, context.deletedOrigins[record.id]?.revision ?? 0) + 1;
  const restored = restoreCanvasHistoryFields(record.before, null, record.fields, {
    source: context.actor.source,
    now: context.now,
    revision,
  });
  const versions = Object.fromEntries(
    Object.keys(restored)
      .concat('$existence')
      .map(field => [field, revision])
  );
  return {
    kind: 'applied',
    reason: null,
    row: { element: restored, fieldOrigins: { ...record.beforeOrigins }, fieldVersions: versions },
    change: { id: record.id, before: null, after: restored, fields: Object.keys(restored) },
  };
}

export function reverseCanvasHistoryEdit(
  record: CanvasHistoryEdit,
  context: CanvasHistoryReversalContext
): CanvasHistoryReversalDecision {
  const current = context.rows.get(record.id);
  if (!current) return { kind: 'skipped', reason: 'element_missing' };
  const claimed = claimedFields(record.id, context);
  const fieldResults = planCanvasHistoryEditFields(record, current, claimed);
  const fields = fieldResults.filter(field => field.status === 'applied').map(field => field.field);
  const reason = canvasHistoryFieldResultReason(fieldResults);
  if (!fields.length)
    return { kind: 'skipped', reason: reason ?? 'later_fields_preserved', fieldResults };
  const after = restoreCanvasHistoryFields(record.before, current.element, fields, {
    source: context.actor.source,
    now: context.now,
    revision: current.element.revision + 1,
  });
  if (!canvasHistoryDependenciesValid(after, context.rows)) {
    return { kind: 'skipped', reason: 'dependency_missing' };
  }
  const origins = { ...current.fieldOrigins };
  const versions = { ...current.fieldVersions };
  // 逻辑来源回到被恢复的写入；版本仍单调增加，旧Agent不能因此重新获准覆盖。
  for (const field of fields) {
    origins[field] = record.beforeOrigins[field];
    versions[field] = after.revision;
  }
  return {
    kind: 'applied',
    reason,
    fieldResults,
    row: { element: after, fieldOrigins: origins, fieldVersions: versions },
    change: { id: record.id, before: current.element, after, fields },
  };
}
