import { z } from 'zod';
import { CanvasSnapshotSchema, CanvasCommitResultSchema } from '../../../src/shared';

export const canvasAgentTaskIds = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13'] as const;
export const CanvasAgentTaskIdSchema = z.enum(canvasAgentTaskIds);
export type CanvasAgentTaskId = z.infer<typeof CanvasAgentTaskIdSchema>;
export interface CanvasAgentTask {
  readonly id: CanvasAgentTaskId;
  readonly title: string;
  readonly prompt: string;
  readonly automatic: readonly string[];
  readonly review: readonly string[];
}
/** 输入由可信验收runner收集，不接纳模型自己报告的成功/点击/计时。 */
export const CanvasAgentEvaluationRunSchema = z.object({
  fixtureVersion: z.literal(1), taskId: CanvasAgentTaskIdSchema,
  model: z.object({ provider: z.string().min(1), model: z.string().min(1), version: z.string().min(1) }).strict(),
  imageCapability: z.enum(['vision', 'no-vision']), evidenceMode: z.enum(['not-applicable', 'offline', 'network']).default('not-applicable'), repetition: z.number().int().positive(),
  startedAt: z.number().nonnegative(), finishedAt: z.number().nonnegative(),
  before: CanvasSnapshotSchema, after: CanvasSnapshotSchema,
  documentIds: z.record(z.string(), z.string()).default({}),
  attempts: z.array(z.object({ requestId: z.string(), validationAccepted: z.boolean(), correction: z.boolean(), responseFile: z.string().min(1) }).strict()),
  commits: z.array(CanvasCommitResultSchema),
  controls: z.object({ approvalShown: z.boolean(), approvalDecision: z.enum(['allow', 'deny']).nullable(), editedCardId: z.string().nullable(), renderCount: z.number().int().nonnegative(), imageReadCount: z.number().int().nonnegative() }).strict(),
  metrics: z.object({ layoutWorkerP50Ms: z.number().nonnegative().optional(), commitToFrameP95Ms: z.number().nonnegative().optional(), averageFps: z.number().nonnegative().optional(), frameP95Ms: z.number().nonnegative().optional(), worstFrameMs: z.number().nonnegative().optional() }).strict(),
  evidenceFiles: z.array(z.string().min(1)).min(1),
  review: z.object({ approved: z.boolean(), reviewer: z.string().min(1), notes: z.string().min(1) }).strict().optional(),
}).strict().refine(run => run.finishedAt >= run.startedAt, '完成时间必须不早于开始时间');
export type CanvasAgentEvaluationRun = z.infer<typeof CanvasAgentEvaluationRunSchema>;
export interface CanvasAgentAssertion { readonly rule: string; readonly passed: boolean; readonly detail: string }
