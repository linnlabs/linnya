import { z } from 'zod';
import { CanvasElementIdSchema, CanvasCardSchema } from '../../model/definitions/canvasElement';
import { CanvasCommitResultSchema } from '../../changeset/definitions/canvasCommands';

export const CanvasPendingApprovalSchema = z.object({
  id: z.string().min(1), groupId: z.string().min(1), requestId: z.string().min(1),
  reason: z.enum(['delete_threshold', 'arrange_threshold']), operationCount: z.number().int().nonnegative(),
  elementIds: z.array(CanvasElementIdSchema), baseSequence: z.number().int().nonnegative(),
  expectedRevisions: z.array(z.object({ id: CanvasElementIdSchema, revision: z.number().int().nonnegative() }).strict()),
  deletedUserCardCount: z.number().int().nonnegative(), movedUserCardCount: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(),
}).strict();
export const CanvasGroupsRequestSchema = z.object({ documentId: z.string().min(1), viewId: z.string().min(1).optional() }).strict();
export const CanvasCloseGroupRequestSchema = z.object({ documentId: z.string().min(1), groupId: z.string().min(1) }).strict();
export const CanvasReviewRequestSchema = z.object({ documentId: z.string().min(1), elementId: CanvasElementIdSchema, groupId: z.string().min(1).optional() }).strict();
export const CanvasAgentGroupSchema = z.object({
  id: z.string().min(1), documentId: z.string().min(1), conversationId: z.string().nullable(), runIds: z.array(z.string()),
  createdAt: z.number().int().nonnegative(), lastWriteAt: z.number().int().nonnegative(), writing: z.boolean(),
  reviewedElementIds: z.array(CanvasElementIdSchema), added: z.array(CanvasElementIdSchema), updated: z.array(CanvasElementIdSchema), deleted: z.array(CanvasElementIdSchema),
  deletedCards: z.array(CanvasCardSchema), visibleDeletedCards: z.array(CanvasCardSchema), pendingApproval: CanvasPendingApprovalSchema.nullable(),
}).strict();
export const CanvasAgentCommitResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('committed'), commit: CanvasCommitResultSchema }).strict(),
  z.object({ kind: z.literal('pending'), approval: CanvasPendingApprovalSchema }).strict(),
]);
export const CanvasWithdrawGroupRequestSchema = z.object({
  documentId: z.string().min(1), viewId: z.string().min(1), requestId: z.string().min(1).max(160), groupId: z.string().min(1), elementIds: z.array(CanvasElementIdSchema).min(1).optional(),
}).strict();
export const CanvasResolveApprovalRequestSchema = z.object({
  documentId: z.string().min(1), viewId: z.string().min(1), requestId: z.string().min(1).max(160), pendingId: z.string().min(1), decision: z.enum(['allow', 'deny']),
}).strict();
export const CanvasApprovalResolutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('committed'), commit: CanvasCommitResultSchema }).strict(),
  z.object({ kind: z.literal('denied') }).strict(),
]);
export type CanvasPendingApproval = z.infer<typeof CanvasPendingApprovalSchema>;
export type CanvasAgentGroup = z.infer<typeof CanvasAgentGroupSchema>;
export type CanvasAgentCommitResult = z.infer<typeof CanvasAgentCommitResultSchema>;
export type CanvasWithdrawGroupRequest = z.infer<typeof CanvasWithdrawGroupRequestSchema>;
export type CanvasResolveApprovalRequest = z.infer<typeof CanvasResolveApprovalRequestSchema>;
export type CanvasApprovalResolution = z.infer<typeof CanvasApprovalResolutionSchema>;

export const CanvasAgentRequestStatusSchema = z.object({
  requestId: z.string(), status: z.enum(['pending', 'committed', 'denied', 'replaced', 'withdrawn', 'closed']),
  pendingId: z.string().nullable(), commit: CanvasCommitResultSchema.nullable(),
}).strict();
export type CanvasAgentRequestStatus = z.infer<typeof CanvasAgentRequestStatusSchema>;
