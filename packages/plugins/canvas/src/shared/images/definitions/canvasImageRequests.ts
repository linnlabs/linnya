import { z } from 'zod';

export const CanvasImportImageRequestSchema = z.object({
  documentId: z.string().min(1), viewId: z.string().min(1), requestId: z.string().min(1).max(160),
  bytesBase64: z.string().min(4).max(64 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  caption: z.string().default(''), alt: z.string().default(''),
  x: z.number().finite().optional(), y: z.number().finite().optional(),
}).strict();
export const CanvasReadImageRequestSchema = z.object({ documentId: z.string().min(1), assetId: z.string().min(1) }).strict();
export type CanvasImportImageRequest = z.infer<typeof CanvasImportImageRequestSchema>;
export type CanvasReadImageRequest = z.infer<typeof CanvasReadImageRequestSchema>;
