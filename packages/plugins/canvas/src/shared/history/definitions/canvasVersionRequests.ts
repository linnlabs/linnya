import { z } from 'zod';
export const CANVAS_HISTORY_BUDGET_CHANNEL = 'canvas:history-budget-changed';
export const CANVAS_RESTORED_CHANNEL = 'canvas:restored';
export const CanvasHistoryPreviewRequestSchema = z
  .object({ documentId: z.string().min(1), versionId: z.string().min(1) })
  .strict();
export const CanvasHistoryBudgetRequestSchema = z
  .object({ documentId: z.string().min(1) })
  .strict();
export const CanvasRestoredMessageSchema = z
  .object({
    documentId: z.string().min(1),
    clientSessionId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
