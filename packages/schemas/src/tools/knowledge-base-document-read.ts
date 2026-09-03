import { z } from 'zod';
import { KnowledgeSearchCitationMetadataSchema } from './knowledge-search';
import { HistoricalResourceReadArgsSchema } from './resource-read';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const KnowledgeReadArgsSchema = z
  .object({
    doc_id: NonEmptyStringSchema,
    mode: z.enum(['full', 'glance']).default('full'),
    start_chunk: PositiveIntegerSchema.default(1),
    end_chunk: PositiveIntegerSchema.optional(),
  })
  .strict()
  .transform(args => ({
    ...args,
    end_chunk: args.end_chunk ?? args.start_chunk,
  }))
  .superRefine((args, context) => {
    if (args.end_chunk < args.start_chunk) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_chunk'],
        message: 'end_chunk cannot be smaller than start_chunk',
      });
    }
  });

export const KnowledgeDocumentChunkSchema = z
  .object({
    index: PositiveIntegerSchema,
    text: z.string(),
  })
  .strict();

const KnowledgeReadDataObjectSchema = z
  .object({
    chunks: z.array(KnowledgeDocumentChunkSchema).min(1),
    filename: NonEmptyStringSchema,
    total_chunks: PositiveIntegerSchema,
    start_chunk: PositiveIntegerSchema,
    end_chunk: PositiveIntegerSchema,
    mode: z.enum(['full', 'glance']),
    has_more: z.boolean(),
    next_start_chunk: PositiveIntegerSchema.nullable(),
    citations: KnowledgeSearchCitationMetadataSchema,
  })
  .strict();

function validateChunkWindow(
  data: z.infer<typeof KnowledgeReadDataObjectSchema>,
  context: z.RefinementCtx
): void {
  if (data.end_chunk < data.start_chunk) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_chunk'],
      message: 'end_chunk cannot be smaller than start_chunk',
    });
  }
  if (data.end_chunk > data.total_chunks) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_chunk'],
      message: 'end_chunk cannot exceed total_chunks',
    });
  }
  if (data.chunks.length !== data.end_chunk - data.start_chunk + 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chunks'],
      message: 'chunks must exactly cover start_chunk through end_chunk',
    });
  }
  for (const [index, chunk] of data.chunks.entries()) {
    if (chunk.index !== data.start_chunk + index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chunks', index, 'index'],
        message: 'chunk indices must be contiguous and match the declared range',
      });
    }
  }
  const expectedNext = data.end_chunk < data.total_chunks ? data.end_chunk + 1 : null;
  if (data.has_more !== (expectedNext !== null) || data.next_start_chunk !== expectedNext) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_start_chunk'],
      message: 'has_more and next_start_chunk must match the actual chunk range',
    });
  }
}

export const KnowledgeReadDataSchema =
  KnowledgeReadDataObjectSchema.superRefine(validateChunkWindow);

const ObservationPreviewMetaSchema = z
  .object({
    filename: NonEmptyStringSchema,
  })
  .strict();

export const KnowledgeReadResultSchema = z
  .object({
    data: KnowledgeReadDataSchema,
    observation: NonEmptyStringSchema,
    observationPreviewMeta: ObservationPreviewMetaSchema.optional(),
  })
  .strict();

const HistoricalKnowledgeBaseResourceReadV2DataObjectSchema = z
  .object({
    uri: z.string().regex(/^kb:\/\/documents\/.+$/),
    source: z.literal('knowledge_base'),
    chunks: z.array(KnowledgeDocumentChunkSchema).min(1),
    filename: NonEmptyStringSchema,
    total_chunks: PositiveIntegerSchema,
    offset: NonNegativeIntegerSchema,
    limit: PositiveIntegerSchema,
    mode: z.enum(['full', 'glance']),
    has_more: z.boolean(),
    next_offset: NonNegativeIntegerSchema.nullable(),
    citations: KnowledgeSearchCitationMetadataSchema,
  })
  .strict();

function validateResourceChunkWindow(
  data: z.infer<typeof HistoricalKnowledgeBaseResourceReadV2DataObjectSchema>,
  context: z.RefinementCtx
): void {
  const startChunk = data.offset + 1;
  const endChunk = data.offset + data.limit;
  if (endChunk > data.total_chunks) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['limit'],
      message: 'resource window cannot exceed total_chunks',
    });
  }
  if (data.chunks.length !== data.limit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chunks'],
      message: 'chunks length must match limit',
    });
  }
  for (const [index, chunk] of data.chunks.entries()) {
    if (chunk.index !== startChunk + index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chunks', index, 'index'],
        message: 'chunk indices must be contiguous and match offset',
      });
    }
  }
  const expectedNext = endChunk < data.total_chunks ? endChunk : null;
  if (data.has_more !== (expectedNext !== null) || data.next_offset !== expectedNext) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'has_more and next_offset must match the actual resource window',
    });
  }
}

const HistoricalKnowledgeBaseResourceReadV2DataSchema =
  HistoricalKnowledgeBaseResourceReadV2DataObjectSchema.superRefine(validateResourceChunkWindow);

/** 旧版 resource_read 的完整 Knowledge wrapper，只允许历史 replay admission。 */
const HistoricalKnowledgeBaseResourceReadV2ResultSchema = z
  .object({
    data: HistoricalKnowledgeBaseResourceReadV2DataSchema,
    observation: NonEmptyStringSchema,
    observationPreviewMeta: ObservationPreviewMetaSchema.optional(),
  })
  .strict();

/** 旧版 resource_read 的 Knowledge 参数，只允许 Renderer 回放已落盘事件。 */
export const HistoricalKnowledgeBaseResourceReadArgsSchema = HistoricalResourceReadArgsSchema.extend({
  uri: z.string().regex(/^kb:\/\/documents\/.+$/),
  offset: NonNegativeIntegerSchema.optional(),
  limit: PositiveIntegerSchema.optional(),
}).strict();

/**
 * 旧版 resource_read 已持久化过缺少 wrapper cursor 字段的知识库结果。
 * 该合同只服务 reload admission，不允许 producer 继续生成这种结构。
 */
const HistoricalKnowledgeBaseResourceReadDataSchema = z
  .object({
    chunks: z.array(KnowledgeDocumentChunkSchema).min(1),
    filename: NonEmptyStringSchema,
    total_chunks: PositiveIntegerSchema,
    mode: z.enum(['full', 'glance']),
    has_more: z.boolean(),
  })
  .strict()
  .superRefine((data, context) => {
    for (const [index, chunk] of data.chunks.entries()) {
      const previous = data.chunks[index - 1];
      if (previous && chunk.index !== previous.index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chunks', index, 'index'],
          message: 'historical chunk indices must be contiguous',
        });
      }
      if (chunk.index > data.total_chunks) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chunks', index, 'index'],
          message: 'historical chunk index cannot exceed total_chunks',
        });
      }
    }
  });

export const HistoricalKnowledgeBaseResourceReadResultSchema = z
  .object({
    data: HistoricalKnowledgeBaseResourceReadDataSchema,
    observation: NonEmptyStringSchema,
  })
  .strict();

export const KnowledgeBaseResourceReadAdmissionResultSchema = z.union([
  HistoricalKnowledgeBaseResourceReadV2ResultSchema,
  HistoricalKnowledgeBaseResourceReadResultSchema,
]);

export type KnowledgeReadArgs = z.infer<typeof KnowledgeReadArgsSchema>;
export type KnowledgeReadResult = z.infer<typeof KnowledgeReadResultSchema>;
