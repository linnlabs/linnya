import type { CanvasCommitPlan, CanvasCommitState } from '../../../features/canvasCommit';
import type { CanvasHistoryChange, CanvasHistoryEntry } from '../definitions/canvasHistory';

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

function independentCardEdit(change: CanvasHistoryChange): boolean {
  return change.before !== null && change.after !== null && change.before.type !== 'edge' && change.after.type !== 'edge'
    && !change.fields.some(field => field === '$existence' || field === 'parentId');
}
function mergeableFields(previous: CanvasHistoryChange, next: CanvasHistoryChange): boolean {
  return previous.id === next.id && previous.after !== null && next.before !== null && next.after !== null
    && next.fields.every(field => previous.fields.includes(field) && previous.afterOrigins[field] === next.beforeOrigins[field]);
}
function mergeHistoryChange(previous: CanvasHistoryChange, next: CanvasHistoryChange): CanvasHistoryChange {
  return { ...previous, after: next.after, afterOrigins: { ...previous.afterOrigins, ...Object.fromEntries(next.fields.map(field => [field, next.afterOrigins[field]])) } };
}

/** 同卡连续修改保留最早前值/最新后值；结构变化和其他来源介入仍保留分段。 */
export function mergeCanvasHistoryEntry(previous: CanvasHistoryEntry, next: CanvasHistoryEntry): CanvasHistoryEntry {
  const changes: CanvasHistoryChange[] = [];
  const independent = new Map<string, number>();
  const remember = (change: CanvasHistoryChange, index: number) => {
    if (independentCardEdit(change)) independent.set(change.id, index);
    else independent.clear();
  };
  // 既有持久组也走相同规则；首次继续写入即可压缩旧批次，不另建一套历史格式。
  for (const entry of [previous, next]) for (const change of entry.changes) {
    const last = changes[changes.length - 1];
    if (last && mergeableFields(last, change)) {
      const merged = mergeHistoryChange(last, change);
      changes[changes.length - 1] = merged; remember(merged, changes.length - 1);
      continue;
    }
    const index = independent.get(change.id), earlier = index === undefined ? undefined : changes[index];
    // 不同卡的普通字段编辑可交换；修订与全部来源连续才可跨卡合并，不能吞掉未记录的外部后写。
    const continuous = earlier?.after && change.before && earlier.after.revision === change.before.revision
      && Object.keys(earlier.afterOrigins).length === Object.keys(change.beforeOrigins).length
      && Object.entries(earlier.afterOrigins).every(([field, origin]) => change.beforeOrigins[field] === origin);
    if (independentCardEdit(change) && earlier && index !== undefined && continuous && mergeableFields(earlier, change)) {
      changes[index] = mergeHistoryChange(earlier, change);
    } else {
      changes.push(change); remember(change, changes.length - 1);
    }
  }
  return { groupId: previous.groupId, actionId: next.actionId, changes };
}
