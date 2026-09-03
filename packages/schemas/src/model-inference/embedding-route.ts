import { z } from 'zod';

export const EMBEDDING_CAPABILITY_IDS = {
  OPENAI_COMPATIBLE: 'ai-sdk:openai-compatible-embeddings',
} as const;

export const EMBEDDING_ROUTE_PROFILES = [{
  id: 'openai_compatible_embeddings',
  api_surface: 'openai_embeddings',
  capability_id: EMBEDDING_CAPABILITY_IDS.OPENAI_COMPATIBLE,
  auth_profiles: ['none', 'bearer'],
}] as const;

const NonEmptyStringSchema = z.string().trim().min(1);

export const ModelEmbeddingRouteSchema = z.object({
  api_surface: z.literal('openai_embeddings'),
  capability_id: z.literal(EMBEDDING_CAPABILITY_IDS.OPENAI_COMPATIBLE),
  endpoint_id: NonEmptyStringSchema,
  endpoint_model_id: NonEmptyStringSchema,
  base_url: NonEmptyStringSchema.transform(value => value.replace(/\/+$/, '')),
  auth_profile: z.enum(['none', 'bearer']),
  usage: z.object({
    response_usage: z.enum(['provider_reported_optional', 'unavailable']),
  }).strict(),
}).strict();

export type ModelEmbeddingRoute = z.infer<typeof ModelEmbeddingRouteSchema>;

export function parseModelEmbeddingRoute(value: unknown): ModelEmbeddingRoute {
  return ModelEmbeddingRouteSchema.parse(value);
}
