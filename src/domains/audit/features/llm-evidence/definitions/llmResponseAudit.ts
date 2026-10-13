import { z } from 'zod';
import { ProviderOutboundFailureSummarySchema } from '@app/schemas';

// 这些上限属于记录端；读取端不能据此反推出历史 execution 的实际丢弃数。
export const LLM_RESPONSE_AUDIT_LIMITS = Object.freeze({
  attemptsPerRunExecution: 64,
  bytesPerRunExecution: 1024 * 1024,
});

const IdentitySchema = z.string().min(1);
const SummaryFields = {
  attemptId: IdentitySchema,
  traceId: IdentitySchema,
  modelId: IdentitySchema,
  endpointId: IdentitySchema,
  endpointModelId: IdentitySchema,
  capabilityId: IdentitySchema,
  apiSurface: IdentitySchema,
  finishReason: z.string().optional(),
  usage: z.object({
    provenance: z.enum(['provider_reported', 'not_reported']),
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    reasoningTokens: z.number().nonnegative().optional(),
    totalTokens: z.number().nonnegative().optional(),
  }).strict(),
};

/** 只读取已发布的 response 摘要；stream、原始错误和供应商响应不是诊断来源。 */
export const LlmResponseAuditSummarySchema = z.discriminatedUnion('outcome', [
  z.object({ ...SummaryFields, outcome: z.literal('succeeded') }).strict(),
  z.object({
    ...SummaryFields,
    outcome: z.literal('failed'),
    failure: ProviderOutboundFailureSummarySchema,
  }).strict(),
]);

export type LlmResponseAuditObservation = {
  readonly envelopeId: string;
  readonly emittedAt: number;
  readonly attemptId: string;
  readonly traceId: string;
  readonly modelId: string;
} & (
  | { readonly outcome: 'succeeded' }
  | { readonly outcome: 'failed'; readonly failure: z.infer<typeof ProviderOutboundFailureSummarySchema> }
);
