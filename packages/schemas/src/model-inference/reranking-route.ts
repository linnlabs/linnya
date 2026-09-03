import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const ModelRerankingRouteSchema = z.object({
  api_surface: z.literal('cohere_rerank'),
  capability_id: z.literal('ai-sdk:cohere-compatible-reranking'),
  endpoint_id: NonEmptyStringSchema,
  endpoint_model_id: NonEmptyStringSchema,
  base_url: NonEmptyStringSchema.transform(value => value.replace(/\/+$/, '')),
  auth_profile: z.literal('bearer'),
  usage: z.object({
    response_usage: z.enum(['provider_reported_optional', 'unavailable']),
  }).strict(),
}).strict();

export type ModelRerankingRoute = z.infer<typeof ModelRerankingRouteSchema>;
