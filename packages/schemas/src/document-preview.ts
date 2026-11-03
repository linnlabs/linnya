import { z } from 'zod';

export const DocumentPreviewRequestSchema = z.object({
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  widthPx: z.number().int().min(120).max(1600).default(640),
  pixelRatio: z.number().positive().max(4).default(1),
}).strict();
export type DocumentPreviewRequest = z.infer<typeof DocumentPreviewRequestSchema>;
export const DocumentPreviewImageSchema = z.object({
  dataUri: z.string().max(8_000_000).regex(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
}).strict();
export const DocumentPreviewContentSchema = z.object({
  revisionKey: z.string().min(1),
  summary: z.string().max(16_000),
  /** 内容owner声明远景偏好；有摘要图片不代表适合保留缩略图。 */
  overview: z.enum(['title', 'thumbnail']).optional(),
  image: DocumentPreviewImageSchema.optional(),
  detail: z.object({ format: z.enum(['markdown', 'text']), text: z.string().max(1_000_000) }).strict().optional(),
}).strict();
export type DocumentPreviewContent = z.infer<typeof DocumentPreviewContentSchema>;
export const DocumentPreviewResultSchema = z.object({
  documentId: z.string(),
  title: z.string().nullable(),
  nodeType: z.string().nullable(),
  status: z.enum(['ready', 'deleted', 'outside_project', 'plugin_unavailable', 'preview_unavailable']),
  content: DocumentPreviewContentSchema.optional(),
}).strict();
export type DocumentPreviewResult = z.infer<typeof DocumentPreviewResultSchema>;

export const DocumentPreviewTypeSchema = z.object({
  nodeType: z.string(), label: z.string(), pluginId: z.string().nullable(), enabled: z.boolean(), hasPreview: z.boolean(),
}).strict();
export const DocumentPreviewTypesSchema = z.array(DocumentPreviewTypeSchema);
export type DocumentPreviewType = z.infer<typeof DocumentPreviewTypeSchema>;
