import { z } from 'zod';
import { HistoricalSharedMemoryUriSchema } from './conversation-artifact-read';
import { HistoricalResourceListArgsSchema } from './document-list';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

/** 以下 schema 只接纳历史 Conversation 事件，不对应 live Agent 工具。 */
export const HistoricalSharedMemoryListArgsSchema = z.object({}).strict();

/** resource_list(source=shared_memory) 的完整 wrapper 参数合同。 */
export const HistoricalSharedMemoryResourceListArgsSchema = HistoricalResourceListArgsSchema.extend({
  source: z.literal('shared_memory'),
});

export const HistoricalSharedMemoryListDocumentSchema = z.object({
  name: NonEmptyStringSchema,
  uri: HistoricalSharedMemoryUriSchema,
  size_bytes: NonNegativeIntegerSchema,
  size_chars: NonNegativeIntegerSchema,
  updated_at_ms: NonNegativeIntegerSchema,
  version: PositiveIntegerSchema,
}).strict();

export const HistoricalSharedMemoryListResultSchema = z.object({
  data: z.object({
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    docs: z.array(HistoricalSharedMemoryListDocumentSchema),
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export const HistoricalSharedMemoryResourceListDocumentSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  uri: HistoricalSharedMemoryUriSchema,
  sizeBytes: NonNegativeIntegerSchema,
  sizeChars: NonNegativeIntegerSchema,
  updatedAtMs: NonNegativeIntegerSchema,
  version: PositiveIntegerSchema,
}).strict();

export const HistoricalSharedMemoryResourceListResultSchema = z.object({
  data: z.object({
    source: z.literal('shared_memory'),
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    docs: z.array(HistoricalSharedMemoryResourceListDocumentSchema),
    total_count: NonNegativeIntegerSchema,
    has_more: z.literal(false),
    offset: z.literal(0),
  }).strict().superRefine((data, context) => {
    if (data.total_count !== data.docs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_count'],
        message: 'total_count must equal docs.length for shared_memory resources',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();

export const HistoricalSharedMemoryWriteArgsSchema = z.object({
  doc_name: z.string({
    required_error: '[sharedmemory_write] doc_name 不能为空',
    invalid_type_error: '[sharedmemory_write] doc_name 不能为空',
  }).trim().min(1, '[sharedmemory_write] doc_name 不能为空'),
  content: z.string({
    required_error: '[sharedmemory_write] content 不能为空',
    invalid_type_error: '[sharedmemory_write] content 不能为空',
  }).min(1, '[sharedmemory_write] content 不能为空'),
  action: z.enum(['write', 'append']).default('write'),
  expected_version: NonNegativeIntegerSchema.optional(),
}).strict();

export const HistoricalSharedMemoryCitationWarningSchema = z.object({
  ref: NonEmptyStringSchema,
  display_ref: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
}).strict();

export const HistoricalSharedMemoryWriteResultSchema = z.object({
  data: z.object({
    source: z.literal('shared_memory'),
    operation: z.enum(['create', 'update']),
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    doc_name: NonEmptyStringSchema,
    uri: HistoricalSharedMemoryUriSchema,
    file_path: NonEmptyStringSchema,
    action: z.enum(['write', 'append']),
    version: PositiveIntegerSchema,
    created: z.boolean(),
    citation_warnings: z.array(HistoricalSharedMemoryCitationWarningSchema).optional(),
  }).strict().superRefine((data, context) => {
    if (data.created !== (data.operation === 'create')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['created'],
        message: 'created must agree with operation',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();

export type HistoricalSharedMemoryListDocument = z.infer<
  typeof HistoricalSharedMemoryListDocumentSchema
>;
export type HistoricalSharedMemoryListResult = z.infer<
  typeof HistoricalSharedMemoryListResultSchema
>;
export type HistoricalSharedMemoryResourceListResult = z.infer<
  typeof HistoricalSharedMemoryResourceListResultSchema
>;
export type HistoricalSharedMemoryWriteArgs = z.infer<
  typeof HistoricalSharedMemoryWriteArgsSchema
>;
export type HistoricalSharedMemoryWriteResult = z.infer<
  typeof HistoricalSharedMemoryWriteResultSchema
>;
