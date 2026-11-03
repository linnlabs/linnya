import { z } from 'zod';
import { CanvasCommitRequestSchema, CanvasElementIdSchema, CanvasPendingApprovalSchema, CanvasSourceSchema } from '../../../../shared';
import { CanvasHistoryEntrySchema } from '../../../shared/history';

export const CanvasAgentGroupRecordSchema = z.object({
  id: z.string(), documentId: z.string(), conversationId: z.string().nullable(), runIds: z.array(z.string()),
  createdAt: z.number(), lastWriteAt: z.number(), entry: CanvasHistoryEntrySchema, reviewedElementIds: z.array(CanvasElementIdSchema), deletedUserCardIds: z.array(CanvasElementIdSchema), deletedAtSequence: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export const CanvasPendingBatchSchema = z.object({
  approval: CanvasPendingApprovalSchema, request: CanvasCommitRequestSchema,
  actor: z.object({ source: CanvasSourceSchema, viewId: z.string(), projectId: z.string().optional() }).strict(), sourceKey: z.string(), payloadHash: z.string(),
}).strict();
export type CanvasAgentGroupRecord = z.infer<typeof CanvasAgentGroupRecordSchema>;
export type CanvasPendingBatch = z.infer<typeof CanvasPendingBatchSchema>;
