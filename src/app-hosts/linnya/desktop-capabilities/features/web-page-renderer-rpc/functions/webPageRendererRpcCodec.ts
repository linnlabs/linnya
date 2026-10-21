import { z } from 'zod';
import { WebRenderFailureKindSchema } from '@app/schemas';


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
      kind: WebRenderFailureKindSchema,
      message: z.string().min(1).max(2_048),
    }).strict(),
  }).strict(),
]);

