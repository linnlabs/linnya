import { z } from 'zod';
import { CanvasAgentRequestStatusSchema, CanvasCommitResultSchema } from '../../../../shared';
import { type CanvasReceiptDatabase, type CanvasRequestReceipt } from '../definitions/canvasRequestReceipt';

const rowSchema = z.object({ request_id: z.string(), payload_hash: z.string(), status: CanvasAgentRequestStatusSchema.shape.status,
  pending_id: z.string().nullable(), result_json: z.string().nullable() });
const columns = 'request_id, payload_hash, status, pending_id, result_json';
function receipt(raw: unknown): CanvasRequestReceipt {
  const row = rowSchema.parse(raw);
  return { requestId: row.request_id, payloadHash: row.payload_hash, status: row.status, pendingId: row.pending_id,
    commit: row.result_json === null ? null : CanvasCommitResultSchema.parse(JSON.parse(row.result_json)) };
}
export function readCanvasRequestReceipt(database: CanvasReceiptDatabase, input: { readonly documentId: string; readonly sourceKey: string; readonly requestId: string }): CanvasRequestReceipt | null {
  const raw = database.prepare(`SELECT ${columns} FROM canvas_requests WHERE node_id = ? AND source_key = ? AND request_id = ?`)
    .get(input.documentId, input.sourceKey, input.requestId);
  return raw ? receipt(raw) : null;
}
export function readCanvasReceipt(database: CanvasReceiptDatabase, input: { readonly documentId: string; readonly sourceKey: string; readonly requestId: string }) {
  const row = readCanvasRequestReceipt(database, input);
  return row?.status === 'committed' && row.commit ? { payloadHash: row.payloadHash, result: row.commit } : null;
}
export function readCanvasPendingReceipt(database: CanvasReceiptDatabase, documentId: string, pendingId: string): CanvasRequestReceipt | null {
  const raw = database.prepare(`SELECT ${columns} FROM canvas_requests WHERE node_id = ? AND pending_id = ?`).get(documentId, pendingId);
  return raw ? receipt(raw) : null;
}
export function listCanvasApprovalReceipts(database: CanvasReceiptDatabase, documentId: string, sourceKey: string): CanvasRequestReceipt[] {
  return database.prepare(`SELECT ${columns} FROM canvas_requests WHERE node_id = ? AND source_key = ? AND pending_id IS NOT NULL ORDER BY rowid DESC LIMIT 50`)
    .all(documentId, sourceKey).map(receipt);
}
