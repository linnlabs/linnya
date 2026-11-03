import { z } from 'zod';
import {
  CanvasCommitResultSchema,
  CanvasOperationResultSchema,
  CanvasCheckReportSchema,
} from '@plugin/canvas/shared';
const commit = CanvasCommitResultSchema.omit({ documentId: true })
  .extend({
    status: z.literal('committed'),
  })
  .strip();
const pending = z.object({
  status: z.literal('pending'),
  requestId: z.string(),
  operationCount: z.number().int().nonnegative(),
  reason: z.string(),
});
const dryRun = z.object({
  status: z.literal('dry-run'),
  tentative: z.literal(true),
  results: z.array(CanvasOperationResultSchema),
});
const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const render = z.object({
  sequence: z.number().int().nonnegative(),
  locator: z.string().startsWith('conversation:/'),
  width: z.number().positive(),
  height: z.number().positive(),
  format: z.enum(['png', 'jpeg']),
  check: CanvasCheckReportSchema.optional(),
  checkScope: z.string().optional(),
});
export function admitCanvasTraceResponse(value: unknown) {
  const committed = commit.safeParse(value);
  if (committed.success) return { kind: 'committed', value: committed.data } as const;
  const proposed = pending.safeParse(value);
  if (proposed.success) return { kind: 'pending', value: proposed.data } as const;
  const previewed = dryRun.safeParse(value);
  if (previewed.success) return { kind: 'dry-run', value: previewed.data } as const;
  const rejected = failure.safeParse(value);
  if (rejected.success) return { kind: 'error', value: rejected.data.error } as const;
  const checked = CanvasCheckReportSchema.safeParse(value);
  if (checked.success) return { kind: 'check', value: checked.data } as const;
  const rendered = render.safeParse(value);
  if (rendered.success) return { kind: 'render', value: rendered.data } as const;
  return { kind: 'unknown' } as const;
}
