import { z } from 'zod';
import { ProviderOutboundFailureSummarySchema } from '../provider-outbound-audit';

const IdentitySchema = z.string().min(1);
const AttemptFields = {
  event_id: IdentitySchema,
  envelope_id: IdentitySchema,
  emitted_at: z.number().finite().nonnegative(),
  attempt_id: IdentitySchema,
  trace_id: IdentitySchema,
  model_id: IdentitySchema,
};
const AttemptSchema = z.discriminatedUnion('outcome', [
  z.object({ ...AttemptFields, outcome: z.literal('succeeded') }).strict(),
  z.object({
    ...AttemptFields,
    outcome: z.literal('failed'),
    failure: ProviderOutboundFailureSummarySchema,
  }).strict(),
]);

/** 仅描述已留存观测；不能从空列表、重试分类或最后一条记录推断当前暂停原因。 */
export const ConversationControlAuditLlmResponsesSchema = z.object({
  coverage: z.literal('best_effort'),
  retention_days: z.number().int().positive(),
  capture_limits: z.object({
    attempts_per_run_execution: z.number().int().positive(),
    bytes_per_run_execution: z.number().int().positive(),
  }).strict(),
  missing_or_dropped_attempts: z.literal('unknown'),
  execution_attribution: z.literal('unavailable'),
  by_run: z.array(z.object({
    run_id: IdentitySchema,
    parent_run_id: IdentitySchema.optional(),
    evidence: z.enum(['observed', 'unavailable']),
    observed_attempts: z.number().int().nonnegative(),
    observed_failures: z.number().int().nonnegative(),
    attempts: z.array(AttemptSchema),
  }).strict()),
}).strict();
