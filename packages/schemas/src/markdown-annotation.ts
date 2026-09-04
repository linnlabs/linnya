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

export const AgentMarkdownAnnotationMetaSchema = z.object({
  source: z.literal('agent'),
  runId: z.string().min(1).optional(),
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
    AgentMarkdownAnnotationMetaSchema,
  ]),
}).strict();

export const MarkdownAnnotationsSchema = z.array(MarkdownAnnotationSchema);

export type MarkdownAnnotationReply = z.infer<typeof MarkdownAnnotationReplySchema>;
export type MarkdownAnnotation = z.infer<typeof MarkdownAnnotationSchema>;
export type MarkdownAnnotationMeta = MarkdownAnnotation['meta'];

export interface ImportedMarkdownAnnotationDraft {
  readonly content: string;
}

export type ParsedMarkdownAnnotationComment =
  | { readonly kind: 'canonical'; readonly annotation: MarkdownAnnotation }
  | { readonly kind: 'plain'; readonly draft: ImportedMarkdownAnnotationDraft };

export interface MarkdownAnnotationAdmission {
  readonly id: string;
  readonly author: string;
  readonly timestamp: string;
  readonly meta: MarkdownAnnotationMeta;
}

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
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[MarkdownAnnotation] canonical JSON 无效: ${detail}`);
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

/**
 * 创建一条可持久化 Annotation 的唯一语义入口。
 *
 * 调用边界负责提供身份、actor、时间和来源；这里统一收口新建态的不变量，
 * 避免 Renderer、Review tool 与文件写入各自拼一份近似对象。
 */
export function createMarkdownAnnotation(params: {
  readonly id: string;
  readonly content: string;
  readonly author: string;
  readonly timestamp: string;
  readonly meta: MarkdownAnnotationMeta;
}): MarkdownAnnotation {
  return MarkdownAnnotationSchema.parse({
    id: params.id,
    content: params.content,
    author: params.author,
    state: 'confirmed',
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
    resolvedAt: null,
    replies: [],
    meta: params.meta,
  });
}

/**
 * 把 HTML comment 接纳为可持久化的 Annotation。
 *
 * canonical profile 保留原身份；普通 comment 只有正文，必须由调用边界注入
 * 新身份、当前作者与时间，避免 parser 自己制造业务事实。
 */
export function admitMarkdownAnnotationComment(
  comment: string,
  admission: MarkdownAnnotationAdmission,
): MarkdownAnnotation {
  const parsed = parseMarkdownAnnotationComment(comment);
  if (parsed.kind === 'canonical') {
    return parsed.annotation;
  }

  return createMarkdownAnnotation({
    ...admission,
    content: parsed.draft.content,
  });
}
