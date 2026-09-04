import { z } from 'zod';

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const MarkdownAnnotationReplySchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  author: z.string().min(1),
  createdAt: IsoTimestampSchema,
}).strict();

export const ManualMarkdownAnnotationMetaSchema = z.object({
  source: z.literal('manual'),
}).strict();

export const ReviewMarkdownAnnotationMetaSchema = z.object({
  source: z.literal('review'),
  reviewRunId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
}).strict();

export const MarkdownAnnotationSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  author: z.string().min(1),
  state: z.enum(['confirmed', 'resolved']),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  resolvedAt: IsoTimestampSchema.nullable(),
  replies: z.array(MarkdownAnnotationReplySchema),
  meta: z.discriminatedUnion('source', [
    ManualMarkdownAnnotationMetaSchema,
    ReviewMarkdownAnnotationMetaSchema,
  ]),
}).strict();

export const MarkdownAnnotationsSchema = z.array(MarkdownAnnotationSchema);

export type MarkdownAnnotationReply = z.infer<typeof MarkdownAnnotationReplySchema>;
export type MarkdownAnnotation = z.infer<typeof MarkdownAnnotationSchema>;

export interface ImportedMarkdownAnnotationDraft {
  readonly content: string;
}

export type ParsedMarkdownAnnotationComment =
  | { readonly kind: 'canonical'; readonly annotation: MarkdownAnnotation }
  | { readonly kind: 'plain'; readonly draft: ImportedMarkdownAnnotationDraft };

const CANONICAL_MARKER = 'linnya-annotation:v1';
const LINNYA_MARKER_PREFIX = 'linnya-annotation:';

function encodeCommentSafeJson(annotation: MarkdownAnnotation): string {
  return JSON.stringify(annotation)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

export function encodeMarkdownAnnotationComment(value: unknown): string {
  const annotation = MarkdownAnnotationSchema.parse(value);
  return `<!-- ${CANONICAL_MARKER}\n${encodeCommentSafeJson(annotation)}\n-->`;
}

export function decodeMarkdownAnnotationComment(comment: string): MarkdownAnnotation {
  const normalized = comment.trim();
  const prefix = `<!-- ${CANONICAL_MARKER}\n`;
  const suffix = '\n-->';
  if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) {
    throw new Error('[MarkdownAnnotation] canonical comment 格式无效');
  }

  const payload = normalized.slice(prefix.length, -suffix.length);
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch (error) {
    throw new Error('[MarkdownAnnotation] canonical JSON 无效', { cause: error });
  }
  return MarkdownAnnotationSchema.parse(decoded);
}

export function parseMarkdownAnnotationComment(comment: string): ParsedMarkdownAnnotationComment {
  const normalized = comment.trim();
  const match = /^<!--([\s\S]*?)-->$/.exec(normalized);
  if (!match) {
    throw new Error('[MarkdownAnnotation] 必须提供完整 HTML comment');
  }

  const body = match[1].trim();
  if (body.startsWith(CANONICAL_MARKER)) {
    return { kind: 'canonical', annotation: decodeMarkdownAnnotationComment(normalized) };
  }
  if (body.startsWith(LINNYA_MARKER_PREFIX)) {
    throw new Error(`[MarkdownAnnotation] 不支持的 profile: ${body.split(/\s/, 1)[0]}`);
  }
  if (body.length === 0) {
    throw new Error('[MarkdownAnnotation] 普通批注内容不能为空');
  }
  return { kind: 'plain', draft: { content: body } };
}
