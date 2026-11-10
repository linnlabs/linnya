import { z } from 'zod';
import { CanvasElementIdSchema, CanvasElementSchema } from '../../../../shared';
export const CanvasHistoryChangeSchema = z
  .object({
    id: CanvasElementIdSchema,
    before: CanvasElementSchema.nullable(),
    after: CanvasElementSchema.nullable(),
    fields: z.array(z.string()),
    beforeOrigins: z.record(z.string(), z.string()),
    afterOrigins: z.record(z.string(), z.string()),
    deletionOrigin: z.string().nullable(),
  })
  .strict();
export const CanvasHistoryEntrySchema = z
  .object({
    changes: z.array(CanvasHistoryChangeSchema),
    groupId: z.string().nullable(),
    actionId: z.string().optional(),
  })
  .strict();
export type CanvasHistoryChange = z.infer<typeof CanvasHistoryChangeSchema>;
export type CanvasHistoryEntry = z.infer<typeof CanvasHistoryEntrySchema>;
