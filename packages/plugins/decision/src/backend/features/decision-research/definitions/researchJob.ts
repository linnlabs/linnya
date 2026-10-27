import { z } from 'zod';
import { ResearchRunArgsSchema, SubagentResultSchema } from '@app/schemas';

export const DocumentObservationSchema = z.object({
  inode: z.string(), path: z.string(), versionNumber: z.number().int().positive(),
  pendingCount: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const ResearchJobSchema = z.object({
  id: z.string().uuid(), decisionId: z.string().uuid(), inputRevision: z.number().int().positive(),
  decisionRevision: z.number().int().positive(), conversationId: z.string(), runId: z.string(),
  scope: ResearchRunArgsSchema, prompt: z.string(),
  materials: z.array(DocumentObservationSchema), createdAt: z.number(),
  delivery: z.object({
    toolCallId: z.string(), result: SubagentResultSchema.shape.data,
    children: z.array(SubagentResultSchema.shape.data),
    documents: z.array(DocumentObservationSchema), observedAt: z.number(),
  }).strict().optional(),
}).strict();
export type ResearchJob = z.infer<typeof ResearchJobSchema>;
