import { z } from 'zod';
import { ConversationControlAcceptedReceiptSchema } from '@app/schemas';
import { CanvasAgentTaskIdSchema } from '../../../../scripts/agent-evaluation';
import type { CanvasEvaluationCommand } from '../../bridge/definitions/canvasEvaluationBridge';
export const CanvasEvaluationRunnerConfigSchema = z
  .object({
    repositoryRoot: z.string().min(1),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    batchId: z.string().min(1),
    taskId: CanvasAgentTaskIdSchema,
    modelConfigId: z.string().min(1),
    model: z
      .object({ provider: z.string().min(1), model: z.string().min(1), version: z.string().min(1) })
      .strict(),
    imageCapability: z.enum(['vision', 'no-vision']),
    repetition: z.number().int().positive().default(1),
    evidenceMode: z.enum(['not-applicable', 'offline', 'network']).default('not-applicable'),
    limitations: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type CanvasEvaluationRunnerConfig = z.infer<typeof CanvasEvaluationRunnerConfigSchema>;
export const CanvasEvaluationRunnerStateSchema = z
  .object({
    config: CanvasEvaluationRunnerConfigSchema,
    projectId: z.string().min(1),
    documentId: z.string().min(1),
    documentIds: z.record(z.string(), z.string()),
    phase: z.enum(['setup', 'attached', 'started']),
    connectionFile: z.string().optional(),
    receipt: ConversationControlAcceptedReceiptSchema.optional(),
    startedAt: z.number().optional(),
    continuations: z
      .array(
        z
          .object({
            step: z.literal('approval-continuation'),
            decision: z.enum(['allow', 'deny']),
            witnessFile: z.string().min(1),
            priorStatusFile: z.string().min(1),
            startedAt: z.number(),
            receipt: ConversationControlAcceptedReceiptSchema,
          })
          .strict()
      )
      .max(1)
      .optional(),
  })
  .strict();
export type CanvasEvaluationRunnerState = z.infer<typeof CanvasEvaluationRunnerStateSchema>;
export const CanvasEvaluationCollectionSchema = z
  .object({
    sourceRevision: z.string(),
    batchId: z.string(),
    collectedAt: z.number(),
    taskId: CanvasAgentTaskIdSchema,
    conversationId: z.string(),
    runId: z.string(),
    errors: z.array(z.string()),
    sourceValid: z.boolean(),
    messagesComplete: z.boolean(),
    evidenceComplete: z.boolean(),
    scoring: z.literal('not-performed'),
    manualActions: z.string().nullable(),
    continuationRunIds: z.array(z.string().min(1)).max(1).optional(),
  })
  .strict();
export const CanvasEvaluationMessagesIndexSchema = z
  .object({
    complete: z.boolean(),
    reason: z.string().optional(),
    files: z.array(z.string().regex(/^messages-\d+\.response\.json$/)),
  })
  .strict();
export type CanvasEvaluationCollection = z.infer<typeof CanvasEvaluationCollectionSchema>;
export interface EvaluationCliInvocation {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly label: string;
  readonly args: readonly string[];
}
export interface EvaluationBridgeInvocation {
  readonly connectionFile: string;
  readonly projectId: string;
  readonly directory: string;
  readonly label: string;
  readonly command: CanvasEvaluationCommand;
}
export interface EvaluationRunnerPorts {
  cli(
    input: EvaluationCliInvocation
  ): Promise<{ readonly exitCode: number; readonly value: unknown }>;
  bridge(input: EvaluationBridgeInvocation): Promise<unknown>;
  verifyRevision(repositoryRoot: string, sourceRevision: string): Promise<void>;
}
