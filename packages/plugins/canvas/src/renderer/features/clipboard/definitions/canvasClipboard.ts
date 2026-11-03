import { z } from 'zod';
import { CanvasElementSchema } from '@plugin/canvas/shared';
export const CANVAS_CLIPBOARD_MIME = 'application/x-linnya-canvas+json';
export const CanvasClipboardSchema = z.object({ version: z.literal(1), elements: z.array(CanvasElementSchema) }).strict();
export type CanvasClipboard = z.infer<typeof CanvasClipboardSchema>;
