import { z } from 'zod';
import type { CanvasToolTraceFacts } from './canvasToolTrace';

export interface CanvasRunDraftInput {
  readonly state: unknown;
  readonly collection: unknown;
  readonly before: unknown;
  readonly after: unknown;
  readonly result: unknown;
  readonly facts: CanvasToolTraceFacts;
  readonly evidenceFiles: readonly string[];
  readonly controls?: unknown;
  readonly metrics?: unknown;
  readonly receiptWitness?: unknown;
}

export const CanvasTraceDraftRequestSchema = z
  .object({
    runDirectory: z.string().min(1),
    collectionLabel: z.string().regex(/^[a-zA-Z0-9-]+$/),
    controlsFile: z.string().min(1).optional(),
    metricsFile: z.string().min(1).optional(),
    receiptWitnessFile: z.string().min(1).optional(),
  })
  .strict();

/** 独立观测的UI/性能证据必须和本次run绑定，不能借用另一题的截图或统计。 */
export const CanvasTraceWitnessScopeSchema = z
  .object({
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    batchId: z.string().min(1),
    documentId: z.string().min(1),
    conversationId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
export type CanvasTraceWitnessScope = z.infer<typeof CanvasTraceWitnessScopeSchema>;
export const CanvasTraceControlsEvidenceSchema = z
  .object({
    scope: CanvasTraceWitnessScopeSchema,
    approvalShown: z.boolean(),
    approvalDecision: z.enum(['allow', 'deny']).nullable(),
    editedCardId: z.string().nullable(),
    evidenceFiles: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const CanvasTraceMetricsEvidenceSchema = z
  .object({
    scope: CanvasTraceWitnessScopeSchema,
    metrics: z.unknown(),
    evidenceFiles: z.array(z.string().min(1)).min(1),
  })
  .strict();
