import type { CanvasAgentRequestStatus, CanvasCommitResult } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';

export const CANVAS_RECENT_REQUEST_LIMIT = 1000;
export type CanvasReceiptDatabase = Pick<CanvasDatabase, 'prepare'>;
export type CanvasTerminalApprovalStatus = Exclude<CanvasAgentRequestStatus['status'], 'pending' | 'committed'>;
export interface CanvasRequestReceipt extends CanvasAgentRequestStatus { readonly payloadHash: string }
export interface CanvasCommittedReceiptInput {
  readonly documentId: string; readonly sourceKey: string; readonly requestId: string;
  readonly payloadHash: string; readonly result: CanvasCommitResult; readonly now: number;
}
