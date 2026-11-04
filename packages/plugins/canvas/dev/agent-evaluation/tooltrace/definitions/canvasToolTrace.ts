import { z } from 'zod';
import { CanvasCheckReportSchema, CanvasCommitResultSchema, CanvasLayoutComputationSchema } from '@plugin/canvas/shared';
export const CanvasTraceScopeSchema = z
  .object({
    conversationId: z.string(),
    rootRunId: z.string(),
    continuationRunIds: z.array(z.string().min(1)).max(1).optional(),
    documentId: z.string(),
    locators: z.array(z.string().startsWith('workspace:')).min(1),
  })
  .strict();
export type CanvasTraceScope = z.infer<typeof CanvasTraceScopeSchema>;
export const CanvasTraceDiagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    sourceFile: z.string(),
    toolCallId: z.string().optional(),
  })
  .strict();
export type CanvasTraceDiagnostic = z.infer<typeof CanvasTraceDiagnosticSchema>;
export const CanvasTraceAttemptSchema = z
  .object({
    requestId: z.string(),
    toolCallId: z.string(),
    sourceFile: z.string(),
    runId: z.string(),
    order: z.number(),
    kind: z.enum(['apply', 'arrange']),
    outcome: z.enum(['committed', 'pending', 'rejected', 'unknown', 'previewed']),
    validationAccepted: z.boolean().nullable(),
    correction: z.boolean().nullable(),
    fingerprint: z.string().nullable(),
    inputKey: z.string().nullable(),
  })
  .strict();
export type CanvasTraceAttempt = z.infer<typeof CanvasTraceAttemptSchema>;
export const CanvasToolTraceFactsSchema = z
  .object({
    scope: CanvasTraceScopeSchema,
    needsReview: z.boolean(),
    diagnostics: z.array(CanvasTraceDiagnosticSchema),
    requests: z.array(
      z
        .object({
          requestId: z.string(),
          runId: z.string(),
          toolCallId: z.string(),
          sourceFile: z.string(),
          order: z.number(),
        })
        .strict()
    ),
    attempts: z.array(CanvasTraceAttemptSchema),
    commits: z.array(CanvasCommitResultSchema),
    layoutComputations: z.array(z.object({
      computation: CanvasLayoutComputationSchema,
      commitSequence: z.number().int().nonnegative(),
      runId: z.string(), toolCallId: z.string(), sourceFile: z.string(), order: z.number(),
    }).strict()),
    layoutComputationGaps: z.array(z.object({ requestId: z.string(), sourceFile: z.string(), toolCallId: z.string() }).strict()),
    replays: z.array(
      z.object({ requestId: z.string(), toolCallId: z.string(), sourceFile: z.string() }).strict()
    ),
    dryRuns: z.array(
      CanvasTraceAttemptSchema.omit({ requestId: true }).extend({
        requestId: z.string().nullable(),
      })
    ),
    checks: z.array(
      z
        .object({
          report: CanvasCheckReportSchema,
          toolCallId: z.string(),
          sourceFile: z.string(),
          order: z.number(),
        })
        .strict()
    ),
    renders: z.array(
      z
        .object({
          sequence: z.number().int(),
          locator: z.string(),
          runId: z.string(),
          toolCallId: z.string(),
          sourceFile: z.string(),
          order: z.number(),
        })
        .strict()
    ),
    imageReads: z.array(
      z
        .object({
          locator: z.string(),
          renderToolCallId: z.string(),
          toolCallId: z.string(),
          sourceFile: z.string(),
          order: z.number(),
        })
        .strict()
    ),
  })
  .strict();
export type CanvasToolTraceFacts = z.infer<typeof CanvasToolTraceFactsSchema>;
export interface CanvasTraceInvocation {
  readonly kind: 'apply' | 'arrange' | 'check' | 'render';
  readonly target: string;
  readonly requestId: string | null;
  readonly dryRun: boolean;
  readonly inputKey: string | null;
  readonly fingerprint: string | null;
  readonly layoutRequested: boolean;
}

export interface CanvasTraceContext {
  readonly facts: CanvasToolTraceFacts;
  readonly toolCallId: string;
  readonly sourceFile: string;
  readonly runId: string;
  readonly order: number;
}
