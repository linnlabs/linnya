import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';
import {
  WebCacheStatusSchema,
  WebExtractionFailureStageSchema,
  WebFailureKindSchema,
  WebReadEscalationReasonSchema,
} from './web-common';
import { HistoricalResourceReadArgsSchema } from './resource-read';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
export const WEB_READ_MAX_CONTENT_CHARS = 50_000;

export const WebReadArgsSchema = z.object({
  url: HttpCitationUrlSchema,
  // 读取编排会把非正数恢复为默认预算，并把正数向下取整、限制到最大预算。
  max_chars: z.number().finite().optional(),
  title_hint: z.string().optional(),
}).strict();

/** 历史 resource_read(http/https) 事件的 replay 参数合同。 */
export const HistoricalWebResourceReadArgsSchema = HistoricalResourceReadArgsSchema.extend({
  uri: HttpCitationUrlSchema,
}).strict();

export const WebReadCitationSchema = z.object({
  sourceType: z.literal('web'),
  ref: CitationRefSchema,
  index: z.number().int().positive(),
  url: HttpCitationUrlSchema,
  docTitle: NonEmptyStringSchema,
  snippet: z.string(),
  siteName: NonEmptyStringSchema.optional(),
  publishedAt: NonEmptyStringSchema.optional(),
  author: NonEmptyStringSchema.optional(),
}).strict();

const WebReadDataObjectSchema = z.object({
  url: HttpCitationUrlSchema,
  title: NonEmptyStringSchema,
  charCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  provider: NonEmptyStringSchema,
  renderMode: z.enum(['http', 'js', 'managed']),
  extractor: NonEmptyStringSchema,
  renderAttempted: z.boolean(),
  escalated: z.boolean(),
  escalationReason: WebReadEscalationReasonSchema.optional(),
  initialFailureKind: WebFailureKindSchema.optional(),
  initialFailureStage: WebExtractionFailureStageSchema.optional(),
  citations: z.object({
    query: HttpCitationUrlSchema,
    searchMode: z.literal('web'),
    citations: z.tuple([WebReadCitationSchema]),
  }).strict(),
  evidence_store: z.object({
    bundle_id: NonEmptyStringSchema,
  }).strict(),
  cacheStatus: WebCacheStatusSchema,
}).strict();

function validateWebReadData(
  data: z.infer<typeof WebReadDataObjectSchema>,
  context: z.RefinementCtx,
): void {
  const citation = data.citations.citations[0];
  if (citation.url !== data.url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations', 'citations', 0, 'url'],
      message: 'web read citation URL must match the canonical result URL',
    });
  }
  if (citation.docTitle !== data.title) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations', 'citations', 0, 'docTitle'],
      message: 'web read citation title must match the result title',
    });
  }
}

const WebReadDataSchema = WebReadDataObjectSchema.superRefine(validateWebReadData);

export const WebReadResultSchema = z.object({
  data: WebReadDataSchema,
  observation: NonEmptyStringSchema,
}).strict();

/** 历史 resource_read(http/https) 事件的 replay 结果合同。 */
export const HistoricalWebResourceReadResultSchema = z.object({
  data: z.object({
    uri: HttpCitationUrlSchema,
    source: z.literal('web'),
    ...WebReadDataObjectSchema.shape,
  }).strict().superRefine(validateWebReadData),
  observation: NonEmptyStringSchema,
}).strict();

export type WebReadArgs = z.infer<typeof WebReadArgsSchema>;
export type WebReadCitation = z.infer<typeof WebReadCitationSchema>;
export type WebReadResult = z.infer<typeof WebReadResultSchema>;
export type HistoricalWebResourceReadResult = z.infer<typeof HistoricalWebResourceReadResultSchema>;
