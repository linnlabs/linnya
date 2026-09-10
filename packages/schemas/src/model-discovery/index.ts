import { z } from 'zod';
import {
  CustomApiFormatSchema,
  normalizeCustomApiBaseUrl,
} from '../custom-api-onboarding';

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveSafeIntegerSchema = z.number().int().positive().safe();

export const ModelDiscoveryRequestSchema = z
  .object({
    api_format: CustomApiFormatSchema,
    base_url: NonEmptyStringSchema,
    api_key: NonEmptyStringSchema.optional(),
  })
  .strict()
  .transform((data, context) => {
    const baseUrl = normalizeCustomApiBaseUrl(data.api_format, data.base_url);
    if (!baseUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base_url'],
        message: '必须是 HTTP 或 HTTPS API 地址',
      });
      return z.NEVER;
    }
    return { ...data, base_url: baseUrl };
  });

export type ModelDiscoveryRequest = z.infer<typeof ModelDiscoveryRequestSchema>;

export const DiscoveredModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    context_window_tokens: PositiveSafeIntegerSchema.optional(),
    max_output_tokens: PositiveSafeIntegerSchema.optional(),
    supports_image_input: z.boolean().optional(),
    confidence: z.enum(['reported', 'inferred', 'fallback']),
  })
  .strict();

export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>;

export const ModelDiscoveryResponseSchema = z
  .object({
    models: z.array(DiscoveredModelSchema),
  })
  .strict();

export type ModelDiscoveryResponse = z.infer<typeof ModelDiscoveryResponseSchema>;

export const MODEL_DISCOVERY_ERROR_CODES = [
  'model_discovery.invalid_request',
  'model_discovery.network_error',
  'model_discovery.auth_failed',
  'model_discovery.unsupported_protocol',
  'model_discovery.failed',
] as const;

export type ModelDiscoveryErrorCode = (typeof MODEL_DISCOVERY_ERROR_CODES)[number];

export const ModelDiscoveryErrorResponseSchema = z
  .object({
    code: z.enum(MODEL_DISCOVERY_ERROR_CODES),
    message: NonEmptyStringSchema,
  })
  .strict();

export type ModelDiscoveryErrorResponse = z.infer<typeof ModelDiscoveryErrorResponseSchema>;
