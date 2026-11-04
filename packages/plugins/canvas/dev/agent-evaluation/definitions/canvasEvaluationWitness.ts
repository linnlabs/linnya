import { z } from 'zod';

/** UI见证锚定首次模型run；审批续轮不能换题、换项目或重置首败。 */
export const CanvasEvaluationWitnessScopeSchema = z
  .object({
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    batchId: z.string().min(1),
    documentId: z.string().min(1),
    conversationId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
export type CanvasEvaluationWitnessScope = z.infer<typeof CanvasEvaluationWitnessScopeSchema>;
export const CanvasEvaluationControlsEvidenceSchema = z
  .object({
    scope: CanvasEvaluationWitnessScopeSchema,
    approvalShown: z.boolean(),
    approvalDecision: z.enum(['allow', 'deny']).nullable(),
    editedCardId: z.string().nullable(),
    evidenceFiles: z.array(z.string().min(1)).min(1),
  })
  .strict();
