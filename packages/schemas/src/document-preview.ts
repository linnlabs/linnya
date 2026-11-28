import { z } from 'zod';
import { JsonValueSchema } from './json-value';
import { DocumentReferencePresentationSchema } from './document-references';

export const DocumentPreviewRequestSchema = z
  .object({
    documentId: z.string().min(1),
    projectId: z.string().min(1),
    widthPx: z.number().int().min(120).max(1600).default(640),
    pixelRatio: z.number().positive().max(4).default(1),
  })
  .strict();
export type DocumentPreviewRequest = z.infer<typeof DocumentPreviewRequestSchema>;
export const DocumentPreviewImageSchema = z
  .object({
    dataUri: z
      .string()
      .max(8_000_000)
      .regex(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
  })
  .strict();
/** 图片的两种正式来源：受管资产，或文档私有媒体目录里的文件（与正文 imageBlock 的 assetId / src 同值）。 */
export const DocumentPreviewImageSourceSchema = z.union([
  z.object({ assetId: z.string().min(1) }).strict(),
  z.object({ src: z.string().regex(/^media:\/\/load\/doc-image\/[A-Za-z0-9_-]+$/) }).strict(),
]);
export type DocumentPreviewImageSource = z.infer<typeof DocumentPreviewImageSourceSchema>;
/** 同一文档内一张图片来源的稳定键，供按来源建表的消费方使用（如随出图请求内联的图片）。 */
export function documentPreviewImageSourceKey(source: DocumentPreviewImageSource): string {
  return 'assetId' in source ? source.assetId : source.src;
}
/** 图片清单项：来源和朝向校正后的原始像素尺寸。字节不随预览返回，由呈现方按显示尺寸另取（DocumentPreviewImageRequest）。 */
export const WorkspaceMarkdownPreviewImageSchema = z
  .object({
    source: DocumentPreviewImageSourceSchema,
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
  })
  .strict();
export type WorkspaceMarkdownPreviewImage = z.infer<typeof WorkspaceMarkdownPreviewImageSchema>;
/** 正式文档的只读快照；图片只列清单（键为 assetId，没有受管身份时为图片块 id），不把 Agent 的文本定位符交给 UI。 */
export const WorkspaceMarkdownPreviewSchema = z
  .object({
    format: z.literal('workspace-markdown'),
    document: JsonValueSchema,
    images: z.record(z.string(), WorkspaceMarkdownPreviewImageSchema),
    references: z.record(
      z.string(),
      DocumentReferencePresentationSchema.pick({
        documentId: true,
        status: true,
        title: true,
        nodeType: true,
      })
    ),
  })
  .strict();
export type WorkspaceMarkdownPreview = z.infer<typeof WorkspaceMarkdownPreviewSchema>;
/** 图片按长边分档提供，呈现方取“不小于实际显示像素”的最小一档；档位固定，缩好的图才能跨入口复用。 */
export const DOCUMENT_PREVIEW_IMAGE_TIERS = [512, 1024, 2048] as const;
export type DocumentPreviewImageTier = (typeof DOCUMENT_PREVIEW_IMAGE_TIERS)[number];
export const DocumentPreviewImageRequestSchema = z
  .object({
    documentId: z.string().min(1),
    projectId: z.string().min(1),
    source: DocumentPreviewImageSourceSchema,
    maxEdgePx: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  })
  .strict();
export type DocumentPreviewImageRequest = z.infer<typeof DocumentPreviewImageRequestSchema>;
/** 一档图片的字节；文档不可读、来源不属于该文档或类型不提供图片时为 null。 */
export const DocumentPreviewImageResultSchema = z
  .object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    bytes: z.instanceof(Uint8Array),
  })
  .strict()
  .nullable();
export type DocumentPreviewImageResult = z.infer<typeof DocumentPreviewImageResultSchema>;
export const DocumentPreviewDetailSchema = z.union([
  z.object({ format: z.enum(['markdown', 'text']), text: z.string().max(1_000_000) }).strict(),
  WorkspaceMarkdownPreviewSchema,
]);
export type DocumentPreviewDetail = z.infer<typeof DocumentPreviewDetailSchema>;
export const DocumentPreviewContentSchema = z
  .object({
    revisionKey: z.string().min(1),
    summary: z.string().max(16_000),
    /** 内容owner声明远景偏好；有摘要图片不代表适合保留缩略图。 */
    overview: z.enum(['title', 'thumbnail']).optional(),
    image: DocumentPreviewImageSchema.optional(),
    detail: DocumentPreviewDetailSchema.optional(),
  })
  .strict();
export type DocumentPreviewContent = z.infer<typeof DocumentPreviewContentSchema>;
export const DocumentPreviewResultSchema = z
  .object({
    documentId: z.string(),
    title: z.string().nullable(),
    nodeType: z.string().nullable(),
    status: z.enum([
      'ready',
      'deleted',
      'outside_project',
      'plugin_unavailable',
      'preview_unavailable',
    ]),
    content: DocumentPreviewContentSchema.optional(),
  })
  .strict();
export type DocumentPreviewResult = z.infer<typeof DocumentPreviewResultSchema>;

export const DocumentPreviewTypeSchema = z
  .object({
    nodeType: z.string(),
    label: z.string(),
    pluginId: z.string().nullable(),
    enabled: z.boolean(),
    hasPreview: z.boolean(),
  })
  .strict();
export const DocumentPreviewTypesSchema = z.array(DocumentPreviewTypeSchema);
export type DocumentPreviewType = z.infer<typeof DocumentPreviewTypeSchema>;
