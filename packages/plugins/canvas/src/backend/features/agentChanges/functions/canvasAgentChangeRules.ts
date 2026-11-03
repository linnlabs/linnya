import type { CanvasAgentGroup, CanvasElementId, CanvasPendingApproval } from '../../../../shared';
import type { CanvasCommitPlan, CanvasCommitState } from '../../canvasCommit';
import type { CanvasHistoryEntry } from '../../../shared/history';
import type { CanvasAgentGroupRecord } from '../definitions/canvasAgentChanges';

/** 只看实际成功删除/移动，拆成多个小批次也不能绕过删除累计门槛。 */
export function evaluateCanvasApproval(before: CanvasCommitState, plan: CanvasCommitPlan, group: CanvasAgentGroupRecord | null) {
  const deletedUser = plan.changes.flatMap(change => change.before && !change.after && change.before.type !== 'edge' && change.before.createdBy.kind === 'user' ? [change.id] : []);
  const deletedUserCardCount = new Set([...(group?.deletedUserCardIds ?? []), ...deletedUser]).size;
  const userCards = before.elements.filter(row => row.element.type !== 'edge' && row.element.createdBy.kind === 'user');
  const moved = new Set(plan.changes.flatMap(change => change.before && change.after && change.before.type !== 'edge' && change.after.type !== 'edge' && change.before.createdBy.kind === 'user' && (change.before.x !== change.after.x || change.before.y !== change.after.y) ? [change.id] : []));
  const reason: CanvasPendingApproval['reason'] | null = deletedUser.length && deletedUserCardCount >= 20 ? 'delete_threshold' : moved.size >= 20 && moved.size >= userCards.length * 0.9 ? 'arrange_threshold' : null;
  return { reason, deletedUserCardCount, movedUserCardCount: moved.size };
}
export function projectCanvasAgentGroup(group: CanvasAgentGroupRecord, pendingApproval: CanvasPendingApproval | null, now: number, visibleAfterSequence?: number): CanvasAgentGroup {
  const byId = new Map<CanvasElementId, CanvasHistoryEntry['changes']>();
  for (const change of group.entry.changes) byId.set(change.id, [...(byId.get(change.id) ?? []), change]);
  const added: CanvasElementId[] = []; const updated: CanvasElementId[] = []; const deleted: CanvasElementId[] = [];
  for (const [id, records] of byId) {
    const first = records[0]; const last = records[records.length - 1];
    if (!first || !last || (!first.before && !last.after) || (first.before ?? last.after)?.type === 'edge') continue;
    if (!first.before && last.after) added.push(id);
    else if (first.before && !last.after) deleted.push(id);
    else if (records.some(record => record.fields.some(field => !['x', 'y', 'order', 'parentId'].includes(field)))) updated.push(id);
  }
  const deletedCards = [...byId.values()].flatMap(records => { const last = records[records.length - 1]; return last?.before && !last.after && last.before.type !== 'edge' ? [last.before] : []; });
  return { id: group.id, documentId: group.documentId, conversationId: group.conversationId, runIds: group.runIds, reviewedElementIds: group.reviewedElementIds, createdAt: group.createdAt, lastWriteAt: group.lastWriteAt, writing: group.entry.changes.length > 0 && now - group.lastWriteAt < 3000, added, updated, deleted, deletedCards, visibleDeletedCards: visibleAfterSequence === undefined ? [] : deletedCards.filter(card => (group.deletedAtSequence[card.id] ?? 0) > visibleAfterSequence), pendingApproval };
}
export function selectCanvasGroupWithdrawal(entry: CanvasHistoryEntry, elementIds: readonly CanvasElementId[] | undefined): { selected: CanvasHistoryEntry; remaining: CanvasHistoryEntry } {
  if (!elementIds) return { selected: entry, remaining: { changes: [], groupId: null } };
  const ids = new Set(elementIds);
  // 逐张撤回也带上本组与该卡相关的线；其他来源的线仍由撤回规则保留。
  for (const change of entry.changes) for (const element of [change.before, change.after]) if (element?.type === 'edge' && [element.from, element.to].some(endpoint => endpoint.kind === 'card' && ids.has(endpoint.cardId))) ids.add(change.id);
  return { selected: { ...entry, changes: entry.changes.filter(change => ids.has(change.id)) }, remaining: { ...entry, changes: entry.changes.filter(change => !ids.has(change.id)) } };
}

export function canvasDeletionReservations(groups: readonly CanvasAgentGroupRecord[], state: CanvasCommitState, visibleAfterSequence: number | undefined) {
  if (visibleAfterSequence === undefined) return [];
  return groups.flatMap(group => projectCanvasAgentGroup(group, null, 0, visibleAfterSequence).visibleDeletedCards.filter(card => {
    const deletion = [...group.entry.changes].reverse().find(change => change.id === card.id && !change.after);
    return deletion && state.deletedOrigins[card.id]?.origin === deletion.deletionOrigin;
  }));
}
