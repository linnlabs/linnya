import { z } from 'zod';

const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const ProviderOutboundOperationSchema = z.enum([
  'language_generation',
  'embedding',
  'reranking',
  'image_generation',
  'document_ocr',
]);

export const ProviderOutboundAttemptStatusSchema = z.enum(['started', 'succeeded', 'failed']);

export const ProviderOutboundRouteIdentitySchema = z
  .object({
    model_id: z.string().min(1),
    endpoint_id: z.string().min(1),
    endpoint_model_id: z.string().min(1),
    api_surface: z.string().min(1),
    capability_id: z.string().min(1),
  })
  .strict();

export const ProviderOutboundInputSummarySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('language_generation'),
      message_count: NonNegativeIntegerSchema,
      message_roles: z
        .object({
          system: NonNegativeIntegerSchema,
          user: NonNegativeIntegerSchema,
          assistant: NonNegativeIntegerSchema,
          tool: NonNegativeIntegerSchema,
        })
        .strict(),
      tool_count: NonNegativeIntegerSchema,
      image_count: NonNegativeIntegerSchema,
      image_media_types: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      kind: z.literal('embedding'),
      value_count: NonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reranking'),
      document_count: NonNegativeIntegerSchema,
      requested_top_n: NonNegativeIntegerSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('image_generation'),
      requested_image_count: NonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('document_ocr'),
      input_kind: z.enum(['pdf', 'image']),
    })
    .strict(),
]);

export const ProviderOutboundUsageSummarySchema = z.discriminatedUnion('provenance', [
  z.object({ provenance: z.literal('pending') }).strict(),
  z.object({ provenance: z.literal('not_reported') }).strict(),
  z
    .object({
      provenance: z.literal('provider_reported'),
      input_tokens: NonNegativeIntegerSchema.optional(),
      output_tokens: NonNegativeIntegerSchema.optional(),
      reasoning_tokens: NonNegativeIntegerSchema.optional(),
      total_tokens: NonNegativeIntegerSchema.optional(),
    })
    .strict(),
]);

export const ProviderOutboundFailureSummarySchema = z
  .object({
    kind: z.enum(['aborted', 'transport', 'provider', 'protocol']),
    code: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const ProviderOutboundAttemptSnapshotSchema = z
  .object({
    schema_version: z.literal(2),
    attempt_id: z.string().min(1),
    trace_id: z.string().min(1).optional(),
    operation: ProviderOutboundOperationSchema,
    route: ProviderOutboundRouteIdentitySchema,
    input: ProviderOutboundInputSummarySchema,
    status: ProviderOutboundAttemptStatusSchema,
    started_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
    duration_ms: z.number().nonnegative().finite().optional(),
    usage: ProviderOutboundUsageSummarySchema,
    finish_reason: z.string().min(1).optional(),
    failure: ProviderOutboundFailureSummarySchema.optional(),
  })
  .strict();

export type ProviderOutboundOperation = z.infer<typeof ProviderOutboundOperationSchema>;
export type ProviderOutboundAttemptStatus = z.infer<typeof ProviderOutboundAttemptStatusSchema>;
export type ProviderOutboundRouteIdentity = z.infer<typeof ProviderOutboundRouteIdentitySchema>;
export type ProviderOutboundInputSummary = z.infer<typeof ProviderOutboundInputSummarySchema>;
export type ProviderOutboundUsageSummary = z.infer<typeof ProviderOutboundUsageSummarySchema>;
export type ProviderOutboundFailureSummary = z.infer<typeof ProviderOutboundFailureSummarySchema>;
export type ProviderOutboundAttemptSnapshot = z.infer<typeof ProviderOutboundAttemptSnapshotSchema>;
