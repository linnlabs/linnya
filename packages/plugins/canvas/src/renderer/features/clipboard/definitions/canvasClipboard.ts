import { z } from 'zod';
import { CanvasElementSchema } from '@plugin/canvas/shared';
export const CANVAS_CLIPBOARD_MIME = 'application/x-linnya-canvas+json';
export const CanvasClipboardSchema = z.object({ version: z.literal(1), elements: z.array(CanvasElementSchema) }).strict();
export type CanvasClipboard = z.infer<typeof CanvasClipboardSchema>;
export type CanvasClipboardPayload = { readonly kind: 'elements'; readonly elements: readonly import('@plugin/canvas/shared').CanvasElement[] }
  | { readonly kind: 'images'; readonly files: readonly File[] } | { readonly kind: 'text'; readonly text: string } | { readonly kind: 'empty' };
