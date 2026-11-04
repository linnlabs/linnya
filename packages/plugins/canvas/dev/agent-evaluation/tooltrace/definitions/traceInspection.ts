import { z } from 'zod';
import { CanvasTraceScopeSchema } from './canvasToolTrace';

export const CanvasTraceInspectionSchema = z
  .object({
    scope: CanvasTraceScopeSchema,
    auditFile: z.string().min(1),
    continuationAuditFiles: z.array(z.string().min(1)).max(1).optional(),
    messageFiles: z.array(z.string().min(1)).min(1),
  })
  .strict();
