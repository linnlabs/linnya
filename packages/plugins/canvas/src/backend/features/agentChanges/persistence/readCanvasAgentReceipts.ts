import {
  CanvasAgentReceiptQueryResultSchema,
  CanvasAgentRequestStatusSchema,
} from '../../../../shared';
import {
  readCanvasRequestReceipt,
  readCanvasPendingReceipt,
  listCanvasApprovalReceipts,
  canvasAgentSourceKey,
} from '../../canvasCommit/queries';
import type { CanvasAgentReceiptDatabase as ReadDatabase } from '../definitions/canvasAgentChanges';
export function readCanvasAgentReceipt(
  database: ReadDatabase,
  documentId: string,
  sourceKey: string,
  requestId: string
) {
  return readCanvasRequestReceipt(database, { documentId, sourceKey, requestId });
}
export function readCanvasApprovalReceipt(
  database: ReadDatabase,
  documentId: string,
  pendingId: string
) {
  return readCanvasPendingReceipt(database, documentId, pendingId);
}
/** 只读原回执，不触发重放；scope由调用方可信身份生成，不公开载荷hash。 */
export function readCanvasAgentRequestStatus(
  database: ReadDatabase,
  documentId: string,
  sourceKey: string,
  requestId: string
) {
  const row = readCanvasAgentReceipt(database, documentId, sourceKey, requestId);
  return row
    ? CanvasAgentRequestStatusSchema.parse({
        requestId,
        status: row.status,
        pendingId: row.pendingId,
        commit: row.commit,
      })
    : null;
}
export function readCanvasAgentRequestStatuses(
  database: ReadDatabase,
  documentId: string,
  conversationId: string | null
) {
  return listCanvasApprovalReceipts(database, documentId, canvasAgentSourceKey(conversationId)).map(
    row => ({
      requestId: row.requestId,
      status: row.status,
      pendingId: row.pendingId,
      commit: row.commit,
    })
  );
}
/** Agent侧身份使用正式VFS路径；其余字段保留同一持久回执，不从当前快照重建。 */
export function projectCanvasAgentReceiptQuery(
  path: string,
  receipt: ReturnType<typeof readCanvasAgentRequestStatus>
) {
  return CanvasAgentReceiptQueryResultSchema.parse({
    documentId: path,
    receipt: receipt
      ? { ...receipt, commit: receipt.commit ? { ...receipt.commit, documentId: path } : null }
      : null,
  });
}
