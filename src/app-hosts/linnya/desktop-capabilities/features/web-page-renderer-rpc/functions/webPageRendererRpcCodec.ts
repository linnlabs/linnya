import { z } from 'zod';

const WebPageRenderFailureKindSchema = z.enum([
  'unavailable',
  'aborted',
  'load_timeout',
  'render_timeout',
  'total_timeout',
  'navigation_blocked',
  'html_too_large',
  'render_process_gone',
  'render_failed',
]);

export const WebPageRenderRpcRequestSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().int().positive().optional(),
}).strict();

export const WebPageRenderRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.object({
      html: z.string(),
      final_url: z.string().url(),
    }).strict(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: WebPageRenderFailureKindSchema,
      message: z.string().min(1).max(2_048),
    }).strict(),
  }).strict(),
]);

