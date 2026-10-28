import { z } from 'zod';
import { RunInputQuoteSchema } from '@app/schemas';
import { DecisionIdSchema, DecisionTextSchema } from './decisionInput';

export const DecisionActionPlanSchema = z.object({
  label: DecisionTextSchema,
  purpose: DecisionTextSchema,
  inputIds: z.array(DecisionIdSchema),
  executor: z.enum(['user', 'agent']),
  estimatedCost: DecisionTextSchema,
}).strict();
export type DecisionActionPlan = z.infer<typeof DecisionActionPlanSchema>;

/** 调用身份由Host提供；输入原句命中不认证作者对现实行动的解释。 */
export const DecisionReportProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent_report'), conversationId: z.string().min(1), agentRunId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('conversation_input_quote'), input: RunInputQuoteSchema }).strict(),
]);
export type DecisionReportProvenance = z.infer<typeof DecisionReportProvenanceSchema>;

/** 结果是明确归属的报告，不是 Host 对现实执行或授权的认证。 */
export const DecisionActionReportSchema = z.object({
  outcome: z.enum(['completed', 'cancelled']),
  summary: DecisionTextSchema,
  origin: DecisionTextSchema,
  actualCost: DecisionTextSchema,
}).strict();

export const DecisionActionWithdrawalSchema = z.object({
  reason: DecisionTextSchema,
  origin: DecisionTextSchema,
}).strict();

const receivedVersions = {
  receivedAtRevision: z.number().int().positive(),
  receivedAgainstInputRevision: z.number().int().positive(),
  resultingInputRevision: z.number().int().positive(),
};
const savedWithdrawal = DecisionActionWithdrawalSchema.extend({
  provenance: DecisionReportProvenanceSchema.optional(), ...receivedVersions,
}).strict();

export const DecisionActionProgressContentSchema = z.object({
  summary: DecisionTextSchema, origin: DecisionTextSchema, actualCost: DecisionTextSchema,
}).strict();
export const DecisionActionReviewRequestSchema = z.object({
  reason: DecisionTextSchema, origin: DecisionTextSchema,
  plan: DecisionActionPlanSchema,
  sourceQuote: z.string().min(1).max(2000).optional(),
}).strict();
export type DecisionActionReviewRequest = z.infer<typeof DecisionActionReviewRequestSchema>;

export const DecisionActionSchema = z.object({
  id: z.string().uuid(),
  basedOnInputRevision: z.number().int().positive(),
  plan: DecisionActionPlanSchema,
  reviews: z.array(z.object({
    plan: DecisionActionPlanSchema, reason: DecisionTextSchema, origin: DecisionTextSchema,
    provenance: DecisionReportProvenanceSchema,
    receivedAtRevision: z.number().int().positive(),
    basedOnInputRevision: z.number().int().positive(),
  }).strict()).optional(),
  progressReports: z.array(DecisionActionProgressContentSchema.extend({
    id: z.string().uuid(), basedOnPlanRevision: z.number().int().positive(),
    provenance: DecisionReportProvenanceSchema, ...receivedVersions,
    withdrawal: savedWithdrawal.optional(),
  }).strict()).optional(),
  result: DecisionActionReportSchema.extend({
    provenance: DecisionReportProvenanceSchema.optional(),
    basedOnPlanRevision: z.number().int().positive().optional(),
    ...receivedVersions,
    withdrawal: savedWithdrawal.optional(),
  }).strict().optional(),
}).strict();
export type DecisionAction = z.infer<typeof DecisionActionSchema>;
