import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CanvasCommitResultSchema, type CanvasCommitResult } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import { canvasSourceKey, type CanvasHistoryCommitInput } from '../../canvasCommit';
import { captureCanvasHistory, mergeCanvasHistoryEntry } from '../../../shared/history';
import { CanvasAgentGroupRecordSchema, CanvasPendingBatchSchema, type CanvasAgentGroupRecord, type CanvasPendingBatch } from '../definitions/canvasAgentChanges';

type ReadDatabase = Pick<CanvasDatabase, 'prepare'>;
const jsonRow = z.object({ record_json: z.string() });
const pendingRow = z.object({ batch_json: z.string() });
const receiptSchema = z.object({ payload_hash: z.string(), status: z.enum(['pending', 'committed', 'denied', 'replaced', 'withdrawn', 'closed']), pending_id: z.string().nullable(), result_json: z.string().nullable() });
export function readCanvasAgentGroup(database: ReadDatabase, documentId: string, groupId: string): CanvasAgentGroupRecord | null {
  const raw = database.prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? AND group_id = ?').get(documentId, groupId);
  return raw ? CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json)) : null;
}
export function readCanvasAgentGroups(database: ReadDatabase, documentId: string): CanvasAgentGroupRecord[] {
  return database.prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? ORDER BY group_id').all(documentId).map(raw => CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json)));
}
export function findCanvasAgentGroup(database: ReadDatabase, documentId: string, sourceKey: string): CanvasAgentGroupRecord | null {
  const raw = database.prepare('SELECT record_json FROM canvas_agent_groups WHERE node_id = ? AND source_key = ?').get(documentId, sourceKey);
  return raw ? CanvasAgentGroupRecordSchema.parse(JSON.parse(jsonRow.parse(raw).record_json)) : null;
}
export function saveCanvasAgentGroup(database: ReadDatabase, group: CanvasAgentGroupRecord): void {
  database.prepare('INSERT INTO canvas_agent_groups(node_id, group_id, source_key, record_json) VALUES (?, ?, ?, ?) ON CONFLICT(node_id, group_id) DO UPDATE SET record_json = excluded.record_json')
    .run(group.documentId, group.id, JSON.stringify(['agent', group.conversationId]), JSON.stringify(group));
}
export function createCanvasAgentGroup(documentId: string, conversationId: string | null, now: number): CanvasAgentGroupRecord {
  return { id: randomUUID(), documentId, conversationId, runIds: [], createdAt: now, lastWriteAt: now, entry: { changes: [], groupId: null }, reviewedElementIds: [], deletedUserCardIds: [], deletedAtSequence: {} };
}
/** 组事实与正文共同提交，不从有界同步日志推导。 */
export function recordCanvasAgentCommit(database: ReadDatabase, input: CanvasHistoryCommitInput): void {
  if (input.context.actor.source.kind !== 'agent' || !input.plan.changes.length) return;
  const { documentId, actor, now } = input.context;
  const previous = findCanvasAgentGroup(database, documentId, canvasSourceKey(actor)) ?? createCanvasAgentGroup(documentId, actor.source.conversationId, now);
  const entry = captureCanvasHistory(input.before, input.plan);
  const deletedUser = input.plan.changes.flatMap(change => change.before && !change.after && change.before.type !== 'edge' && change.before.createdBy.kind === 'user' ? [change.id] : []);
  const runIds = actor.source.runId ? [...new Set([...previous.runIds, actor.source.runId])] : previous.runIds;
  const deletedAtSequence = { ...previous.deletedAtSequence };
  for (const change of input.plan.changes) { if (change.after) delete deletedAtSequence[change.id]; else deletedAtSequence[change.id] = input.plan.state.sequence; }
  saveCanvasAgentGroup(database, { ...previous, reviewedElementIds: previous.reviewedElementIds.filter(id => !input.plan.changes.some(change => change.id === id)), deletedAtSequence, entry: mergeCanvasHistoryEntry(previous.entry, entry), lastWriteAt: now, runIds, deletedUserCardIds: [...new Set([...previous.deletedUserCardIds, ...deletedUser])] });
}
export function readCanvasPendingApproval(database: ReadDatabase, documentId: string, pendingId: string): CanvasPendingBatch | null {
  const raw = database.prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ? AND pending_id = ?').get(documentId, pendingId);
  return raw ? CanvasPendingBatchSchema.parse(JSON.parse(pendingRow.parse(raw).batch_json)) : null;
}
export function findCanvasPendingApproval(database: ReadDatabase, documentId: string, groupId: string): CanvasPendingBatch | null {
  const raw = database.prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ? AND group_id = ?').get(documentId, groupId);
  return raw ? CanvasPendingBatchSchema.parse(JSON.parse(pendingRow.parse(raw).batch_json)) : null;
}
export function clearCanvasPendingApproval(database: ReadDatabase, documentId: string, groupId: string, reason: 'denied' | 'replaced' | 'withdrawn' | 'closed'): void {
  database.prepare('UPDATE canvas_agent_requests SET status = ? WHERE node_id = ? AND status = ? AND pending_id IN (SELECT pending_id FROM canvas_pending_approvals WHERE node_id = ? AND group_id = ?)').run(reason, documentId, 'pending', documentId, groupId);
  database.prepare('DELETE FROM canvas_pending_approvals WHERE node_id = ? AND group_id = ?').run(documentId, groupId);
}
export function saveCanvasPendingApproval(database: ReadDatabase, batch: CanvasPendingBatch): void {
  clearCanvasPendingApproval(database, batch.request.documentId, batch.approval.groupId, 'replaced');
  database.prepare('INSERT INTO canvas_pending_approvals(node_id, pending_id, group_id, batch_json) VALUES (?, ?, ?, ?)').run(batch.request.documentId, batch.approval.id, batch.approval.groupId, JSON.stringify(batch));
  database.prepare('INSERT INTO canvas_agent_requests(node_id, source_key, request_id, payload_hash, status, pending_id) VALUES (?, ?, ?, ?, ?, ?)').run(batch.request.documentId, batch.sourceKey, batch.request.requestId, batch.payloadHash, 'pending', batch.approval.id);
}
export function readCanvasAgentReceipt(database: ReadDatabase, documentId: string, sourceKey: string, requestId: string) {
  const raw = database.prepare('SELECT payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND source_key = ? AND request_id = ?').get(documentId, sourceKey, requestId);
  return raw ? receiptSchema.parse(raw) : null;
}
export function readCanvasApprovalReceipt(database: ReadDatabase, documentId: string, pendingId: string) {
  const raw = database.prepare('SELECT payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND pending_id = ?').get(documentId, pendingId);
  return raw ? receiptSchema.parse(raw) : null;
}
export function completeCanvasApproval(database: ReadDatabase, batch: CanvasPendingBatch, result: CanvasCommitResult): void {
  database.prepare('UPDATE canvas_agent_requests SET status = ?, result_json = ? WHERE node_id = ? AND source_key = ? AND request_id = ?').run('committed', JSON.stringify(result), batch.request.documentId, batch.sourceKey, batch.request.requestId);
  database.prepare('DELETE FROM canvas_pending_approvals WHERE node_id = ? AND pending_id = ?').run(batch.request.documentId, batch.approval.id);
  const group = readCanvasAgentGroup(database, batch.request.documentId, batch.approval.groupId);
  if (group) saveCanvasAgentGroup(database, { ...group, deletedUserCardIds: [] });
}
export function parseCanvasAgentReceiptResult(serialized: string): CanvasCommitResult { return CanvasCommitResultSchema.parse(JSON.parse(serialized)); }
export function deleteCanvasAgentGroup(database: ReadDatabase, documentId: string, groupId: string): void {
  clearCanvasPendingApproval(database, documentId, groupId, 'closed');
  database.prepare('DELETE FROM canvas_agent_groups WHERE node_id = ? AND group_id = ?').run(documentId, groupId);
}

export function reviewCanvasAgentElement(database: ReadDatabase, input: { readonly documentId: string; readonly elementId: import('../../../../shared').CanvasElementId; readonly groupId?: string }): void {
  for (const group of readCanvasAgentGroups(database, input.documentId)) {
    if ((!input.groupId || group.id === input.groupId) && group.entry.changes.some(change => change.id === input.elementId) && !group.reviewedElementIds.includes(input.elementId)) saveCanvasAgentGroup(database, { ...group, reviewedElementIds: [...group.reviewedElementIds, input.elementId] });
  }
}

/** 原始 CLI 身份和正文提交共同保存，append 重试不能先重新计算第二次正文。 */
export function saveCanvasAgentCommittedReceipt(database: ReadDatabase, input: { readonly documentId: string; readonly sourceKey: string; readonly requestId: string; readonly payloadHash: string; readonly result: CanvasCommitResult }): void {
  database.prepare('INSERT INTO canvas_agent_requests(node_id, source_key, request_id, payload_hash, status, result_json) VALUES (?, ?, ?, ?, ?, ?)').run(input.documentId, input.sourceKey, input.requestId, input.payloadHash, 'committed', JSON.stringify(input.result));
}
export function readCanvasAgentRequestStatuses(database: ReadDatabase, documentId: string, conversationId: string | null): import('../../../../shared').CanvasAgentRequestStatus[] {
  return database.prepare('SELECT request_id, payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND source_key = ? AND pending_id IS NOT NULL ORDER BY rowid DESC LIMIT 50').all(documentId, JSON.stringify(['agent', conversationId])).map(raw => {
    const row = receiptSchema.extend({ request_id: z.string() }).parse(raw);
    return { requestId: row.request_id, status: row.status, pendingId: row.pending_id, commit: row.result_json ? parseCanvasAgentReceiptResult(row.result_json) : null };
  });
}

export function readCanvasPendingBatches(database: CanvasDatabase, documentId: string): CanvasPendingBatch[] {
  return database.prepare('SELECT batch_json FROM canvas_pending_approvals WHERE node_id = ?').all(documentId).map(raw => CanvasPendingBatchSchema.parse(JSON.parse(z.object({ batch_json: z.string() }).parse(raw).batch_json)));
}
