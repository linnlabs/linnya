import { z } from 'zod';
import { CanvasElementIdSchema } from '../../model/definitions/canvasElement';
export const CanvasSelectionContextRequestSchema = z.object({
  documentId: z.string().min(1), elementIds: z.array(CanvasElementIdSchema).min(1), conversationId: z.string().min(1).optional(),
}).strict();
export const CanvasSelectionContextSchema = z.object({
  documentId: z.string().min(1), sequence: z.number().int().nonnegative(), elementIds: z.array(CanvasElementIdSchema),
  path: z.string().startsWith('workspace:'), text: z.string(),
}).strict();
export type CanvasSelectionContextRequest = z.infer<typeof CanvasSelectionContextRequestSchema>;
