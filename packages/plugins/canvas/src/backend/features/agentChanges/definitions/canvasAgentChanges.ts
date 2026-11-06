import { z } from 'zod';
import { CanvasCommitRequestSchema, CanvasElementIdSchema, CanvasPendingApprovalSchema, CanvasSourceSchema, CanvasGroupWriteOutcomesSchema } from '../../../../shared';
import { CanvasHistoryEntrySchema } from '../../../shared/history';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasCommitState } from '../../canvasCommit';

export const CANVAS_AGENT_WRITING_IDLE_MS = 3000;
export const CANVAS_AGENT_APPROVAL_CARD_THRESHOLD = 20;
export const CANVAS_AGENT_APPROVAL_MOVE_RATIO = 0.9;

export type CanvasAgentReceiptDatabase = Pick<CanvasDatabase, 'prepare'>;
/** 只由实际新建持久组触发；before可早于当前已落SQL的内容，不能再从current猜开组状态。 */
export interface CanvasAgentGroupStart {
  readonly documentId: string;
  readonly before: CanvasCommitState;
  readonly now: number;
}

export const CanvasAgentGroupRecordSchema = z.object({
  id: z.string(), documentId: z.string(), conversationId: z.string().nullable(), runIds: z.array(z.string()),
  createdAt: z.number(), lastWriteAt: z.number(), entry: CanvasHistoryEntrySchema, reviewedElementIds: z.array(CanvasElementIdSchema), deletedUserCardIds: z.array(CanvasElementIdSchema), deletedAtSequence: z.record(z.string(), z.number().int().nonnegative()),
  outcomes: CanvasGroupWriteOutcomesSchema,
}).strict();
export const CanvasPendingBatchSchema = z.object({
  approval: CanvasPendingApprovalSchema, request: CanvasCommitRequestSchema,
  actor: z.object({ source: CanvasSourceSchema, viewId: z.string(), projectId: z.string().optional() }).strict(), sourceKey: z.string(), payloadHash: z.string(),
}).strict();
export type CanvasAgentGroupRecord = z.infer<typeof CanvasAgentGroupRecordSchema>;
export type CanvasPendingBatch = z.infer<typeof CanvasPendingBatchSchema>;
