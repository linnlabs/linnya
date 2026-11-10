import { z } from 'zod';
import { CanvasElementIdSchema, CanvasElementSchema } from '../../model/definitions/canvasElement';
export const CanvasSelectionContextRequestSchema = z
  .object({
    documentId: z.string().min(1),
    elementIds: z.array(CanvasElementIdSchema).min(1),
    conversationId: z.string().min(1).optional(),
    projectId: z.string().min(1).nullable().optional(),
    format: z.enum(['context', 'markdown']).default('context'),
  })
  .strict();
export const CanvasSelectionContextSchema = z
  .object({
    documentId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    elementIds: z.array(CanvasElementIdSchema),
    path: z.string().startsWith('workspace:'),
    text: z.string(),
  })
  .strict();
export type CanvasSelectionContextRequest = z.infer<typeof CanvasSelectionContextRequestSchema>;

// 剪贴板正文与结构来自同一已提交快照，持续的 Agent 写入不会制造混版。
export const CanvasClipboardRequestSchema = CanvasSelectionContextRequestSchema.omit({
  format: true,
});
export const CanvasClipboardSchema = CanvasSelectionContextSchema.extend({
  elements: z.array(CanvasElementSchema),
}).strict();
export type CanvasClipboard = z.infer<typeof CanvasClipboardSchema>;
