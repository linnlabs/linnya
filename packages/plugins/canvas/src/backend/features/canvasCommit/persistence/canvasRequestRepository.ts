import {
  CANVAS_RECENT_REQUEST_LIMIT,
  type CanvasReceiptDatabase,
  type CanvasCommittedReceiptInput,
  type CanvasTerminalApprovalStatus,
} from '../definitions/canvasRequestReceipt';

export function saveCanvasCommittedReceipt(
  database: CanvasReceiptDatabase,
  input: CanvasCommittedReceiptInput
): void {
  // 回执行身份只由(document,source,request)定义。终态替换获取新的插入次序，旧pending即使等待很久也有完整的最近结果窗口。
  // 没有表引用rowid；pendingId保留供审批重试，正式结果只在此处存一份。
  database
    .prepare(
      `INSERT OR REPLACE INTO canvas_requests
    (node_id, source_key, request_id, payload_hash, status, pending_id, group_id, result_json, created_at)
    VALUES (?, ?, ?, ?, 'committed', (SELECT pending_id FROM canvas_requests WHERE node_id = ? AND source_key = ? AND request_id = ?), NULL, ?, ?)`
    )
    .run(
      input.documentId,
      input.sourceKey,
      input.requestId,
      input.payloadHash,
      input.documentId,
      input.sourceKey,
      input.requestId,
      JSON.stringify(input.result),
      input.now
    );
}
export function saveCanvasPendingReceipt(
  database: CanvasReceiptDatabase,
  input: {
    readonly documentId: string;
    readonly sourceKey: string;
    readonly requestId: string;
    readonly payloadHash: string;
    readonly pendingId: string;
    readonly groupId: string;
    readonly now: number;
  }
): void {
  database
    .prepare(
      `INSERT INTO canvas_requests (node_id, source_key, request_id, payload_hash, status, pending_id, group_id, result_json, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?)`
    )
    .run(
      input.documentId,
      input.sourceKey,
      input.requestId,
      input.payloadHash,
      input.pendingId,
      input.groupId,
      input.now
    );
}
export function finishCanvasPendingReceipts(
  database: CanvasReceiptDatabase,
  documentId: string,
  groupId: string,
  status: CanvasTerminalApprovalStatus
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO canvas_requests
    (node_id, source_key, request_id, payload_hash, status, pending_id, group_id, result_json, created_at)
    SELECT node_id, source_key, request_id, payload_hash, ?, pending_id, NULL, NULL, ?
    FROM canvas_requests WHERE node_id = ? AND group_id = ? AND status = 'pending'`
    )
    .run(status, Date.now(), documentId, groupId);
  pruneCanvasRequestReceipts(database, documentId);
}
/** 仅固定组真正引用的结果；普通成功提交的回执不是撤回依赖，不能随长期未关闭的组无限保留。 */
export function retainCanvasRequestForGroup(
  database: CanvasReceiptDatabase,
  input: {
    readonly documentId: string;
    readonly sourceKey: string;
    readonly requestId: string;
    readonly groupId: string;
  }
): void {
  database
    .prepare(
      'UPDATE canvas_requests SET group_id = ? WHERE node_id = ? AND source_key = ? AND request_id = ?'
    )
    .run(input.groupId, input.documentId, input.sourceKey, input.requestId);
}
export function releaseCanvasGroupReceipts(
  database: CanvasReceiptDatabase,
  documentId: string,
  groupId: string
): void {
  database
    .prepare('UPDATE canvas_requests SET group_id = NULL WHERE node_id = ? AND group_id = ?')
    .run(documentId, groupId);
  pruneCanvasRequestReceipts(database, documentId);
}
/** 1000条最近未固定终态，另保留pending和仍被组引用的回执；索引使普通清理不扫描固定组。 */
export function pruneCanvasRequestReceipts(
  database: CanvasReceiptDatabase,
  documentId: string
): void {
  database
    .prepare(
      `DELETE FROM canvas_requests WHERE node_id = ? AND group_id IS NULL AND status <> 'pending'
    AND rowid < (SELECT rowid FROM canvas_requests WHERE node_id = ? AND group_id IS NULL AND status <> 'pending'
      ORDER BY rowid DESC LIMIT 1 OFFSET ?)`
    )
    .run(documentId, documentId, CANVAS_RECENT_REQUEST_LIMIT - 1);
}
