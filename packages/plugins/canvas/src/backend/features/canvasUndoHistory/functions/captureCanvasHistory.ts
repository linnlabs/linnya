import type { CanvasCommitPlan, CanvasCommitState } from '../../canvasCommit';
import type { CanvasHistoryEntry } from '../definitions/canvasHistory';

export function captureCanvasHistory(before: CanvasCommitState, plan: CanvasCommitPlan, groupId: string | null = null): CanvasHistoryEntry {
  const previous = new Map(before.elements.map(row => [row.element.id, row]));
  const current = new Map(plan.state.elements.map(row => [row.element.id, row]));
  const fields = new Map(plan.changes.map(change => [change.id, new Set<string>()]));
  for (const change of plan.changes) for (const field of change.fields) fields.get(change.id)?.add(field);
  return { groupId, changes: [...fields].map(([id, changedFields]) => ({ id,
    before: previous.get(id)?.element ?? null, after: current.get(id)?.element ?? null,
    fields: [...changedFields], beforeOrigins: { ...previous.get(id)?.fieldOrigins }, afterOrigins: { ...current.get(id)?.fieldOrigins },
    deletionOrigin: current.has(id) ? null : plan.origin,
  })) };
}

/** 连续自动保存只保留最早前值/最新后值；其他来源介入时保留分段，撤回不能跨过去。 */
export function mergeCanvasHistoryEntry(previous: CanvasHistoryEntry, next: CanvasHistoryEntry): CanvasHistoryEntry {
  const changes = [...previous.changes];
  for (const change of next.changes) {
    const last = changes[changes.length - 1];
    if (last && last.id === change.id && last.after && change.before && change.after && change.fields.every(field => last.fields.includes(field) && last.afterOrigins[field] === change.beforeOrigins[field])) {
      changes[changes.length - 1] = { ...last, after: change.after, afterOrigins: change.afterOrigins };
    } else changes.push(change);
  }
  return { groupId: previous.groupId, changes };
}
