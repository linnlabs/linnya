import { z } from 'zod';

export const DOCUMENT_OCR_CAPABILITY_IDS = {
  PADDLE_LAYOUT_PARSING: 'host:paddle-ocr-layout-parsing',
  PADDLE_OCR_JOBS: 'host:paddle-ocr-jobs',
} as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveIntegerSchema = z.number().int().positive();

const DocumentOcrRouteBaseSchema = z.object({
  endpoint_id: NonEmptyStringSchema,
  endpoint_model_id: NonEmptyStringSchema,
  base_url: NonEmptyStringSchema.transform(value => value.replace(/\/+$/, '')),
  mode: z.enum(['document_upload', 'page_image']),
  supports_abort_signal: z.boolean(),
  attempt_timeout_ms: PositiveIntegerSchema,
  max_input_pages: PositiveIntegerSchema.optional(),
});

export const PaddleLayoutParsingRouteSchema = DocumentOcrRouteBaseSchema.extend({
  api_surface: z.literal('paddle_layout_parsing'),
  capability_id: z.literal(DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_LAYOUT_PARSING),
  auth_profile: z.literal('token'),
}).strict();

export const PaddleOcrJobsRouteSchema = DocumentOcrRouteBaseSchema.extend({
  api_surface: z.literal('paddle_ocr_jobs'),
  capability_id: z.literal(DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_OCR_JOBS),
  auth_profile: z.literal('bearer'),
  poll_interval_ms: PositiveIntegerSchema,
}).strict();

export const DocumentOcrRouteSchema = z.discriminatedUnion('api_surface', [
  PaddleLayoutParsingRouteSchema,
  PaddleOcrJobsRouteSchema,
]);

export type DocumentOcrRoute = z.infer<typeof DocumentOcrRouteSchema>;

export function parseDocumentOcrRoute(value: unknown): DocumentOcrRoute {
  return DocumentOcrRouteSchema.parse(value);
}
