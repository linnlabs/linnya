import * as z from 'zod';
import { CanvasAgentReceiptQueryResultSchema, CanvasAgentRequestStatusSchema, CanvasCommitResultSchema, type CanvasCommitResult } from '../../../../shared';
import type { CanvasAgentReceiptDatabase as ReadDatabase } from '../definitions/canvasAgentChanges';
const receiptSchema = z.object({ payload_hash: z.string(), status: z.enum(['pending', 'committed', 'denied', 'replaced', 'withdrawn', 'closed']), pending_id: z.string().nullable(), result_json: z.string().nullable() });
export function readCanvasAgentReceipt(database: ReadDatabase, documentId: string, sourceKey: string, requestId: string) {
  const raw = database.prepare('SELECT payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND source_key = ? AND request_id = ?').get(documentId, sourceKey, requestId);
  return raw ? receiptSchema.parse(raw) : null;
}
export function readCanvasApprovalReceipt(database: ReadDatabase, documentId: string, pendingId: string) {
  const raw = database.prepare('SELECT payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND pending_id = ?').get(documentId, pendingId);
  return raw ? receiptSchema.parse(raw) : null;
}
export function parseCanvasAgentReceiptResult(serialized: string): CanvasCommitResult { return CanvasCommitResultSchema.parse(JSON.parse(serialized)); }
/** 只读原回执，不触发重放；scope由调用方可信身份生成，不公开载荷hash。 */
export function readCanvasAgentRequestStatus(database: ReadDatabase, documentId: string, sourceKey: string, requestId: string) {
  const row = readCanvasAgentReceipt(database, documentId, sourceKey, requestId);
  return row ? CanvasAgentRequestStatusSchema.parse({ requestId, status: row.status, pendingId: row.pending_id, commit: row.result_json ? parseCanvasAgentReceiptResult(row.result_json) : null }) : null;
}
export function readCanvasAgentRequestStatuses(database: ReadDatabase, documentId: string, conversationId: string | null) {
  return database.prepare('SELECT request_id, payload_hash, status, pending_id, result_json FROM canvas_agent_requests WHERE node_id = ? AND source_key = ? AND pending_id IS NOT NULL ORDER BY rowid DESC LIMIT 50').all(documentId, JSON.stringify(['agent', conversationId])).map(raw => {
    const row = receiptSchema.extend({ request_id: z.string() }).parse(raw);
    return { requestId: row.request_id, status: row.status, pendingId: row.pending_id, commit: row.result_json ? parseCanvasAgentReceiptResult(row.result_json) : null };
  });
}
/** Agent侧身份使用正式VFS路径；其余字段保留同一持久回执，不从当前快照重建。 */
export function projectCanvasAgentReceiptQuery(path: string, receipt: ReturnType<typeof readCanvasAgentRequestStatus>) {
  return CanvasAgentReceiptQueryResultSchema.parse({ documentId: path, receipt: receipt ? { ...receipt, commit: receipt.commit ? { ...receipt.commit, documentId: path } : null } : null });
}
