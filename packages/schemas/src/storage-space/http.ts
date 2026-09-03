import { z } from 'zod';

export const STORAGE_SPACE_CATEGORY_ORDER = [
  'conversation_work_files',
  'workspace',
  'attachments',
  'temporary_outputs',
  'diagnostic_logs',
  'application_data',
] as const;

export const StorageSpaceCategoryKindSchema = z.enum(STORAGE_SPACE_CATEGORY_ORDER);
export type StorageSpaceCategoryKind = z.infer<typeof StorageSpaceCategoryKindSchema>;

/**
 * Storage Space 复用现有对话身份语义。目录安全由后端摘要身份保证，
 * 因此这里不能擅自拒绝斜杠或反斜杠等合法对话字符。
 */
export const StorageSpaceConversationIdSchema = z.string()
  .min(1)
  .refine(
    value => value === value.trim(),
    'conversation identity must not contain surrounding whitespace',
  )
  .refine(
    value => !value.includes('\0'),
    'conversation identity must not contain NUL',
  );
export type StorageSpaceConversationId = z.infer<typeof StorageSpaceConversationIdSchema>;

export const StorageSpaceConversationWorkFilesStateSchema = z.enum([
  'not_created',
  'previous_files_unavailable',
  'available',
  'unavailable',
]);
export type StorageSpaceConversationWorkFilesState = z.infer<
  typeof StorageSpaceConversationWorkFilesStateSchema
>;

const NonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

export const StorageSpaceCategoryUsageSchema = z.object({
  kind: StorageSpaceCategoryKindSchema,
  byte_size: NonnegativeSafeIntegerSchema,
}).strict();
export type StorageSpaceCategoryUsage = z.infer<typeof StorageSpaceCategoryUsageSchema>;

export const StorageSpaceConversationUsageSchema = z.object({
  conversation_id: StorageSpaceConversationIdSchema,
  title: z.string(),
  project_id: z.string().nullable(),
  work_files_state: StorageSpaceConversationWorkFilesStateSchema,
  byte_size: NonnegativeSafeIntegerSchema.nullable(),
  file_count: NonnegativeSafeIntegerSchema.nullable(),
}).strict().superRefine((usage, context) => {
  if (usage.work_files_state === 'unavailable') {
    if (usage.byte_size !== null || usage.file_count !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unmeasured work files must not expose byte or file counts',
        path: ['work_files_state'],
      });
    }
    return;
  }
  if (usage.byte_size === null || usage.file_count === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'measured work files must expose byte and file counts',
      path: ['work_files_state'],
    });
    return;
  }
  if (
    usage.work_files_state !== 'available'
    && (usage.byte_size !== 0 || usage.file_count !== 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'absent work files must have zero byte and file counts',
      path: ['work_files_state'],
    });
  }
});
export type StorageSpaceConversationUsage = z.infer<
  typeof StorageSpaceConversationUsageSchema
>;

export const StorageSpaceOverviewResponseSchema = z.object({
  measured_at_ms: NonnegativeSafeIntegerSchema,
  total_byte_size: NonnegativeSafeIntegerSchema,
  categories: z.array(StorageSpaceCategoryUsageSchema).length(
    STORAGE_SPACE_CATEGORY_ORDER.length,
  ),
  conversations: z.array(StorageSpaceConversationUsageSchema),
}).strict().superRefine((overview, context) => {
  const seen = new Set<StorageSpaceCategoryKind>();
  for (const [index, category] of overview.categories.entries()) {
    if (seen.has(category.kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate storage category: ${category.kind}`,
        path: ['categories', index, 'kind'],
      });
    }
    seen.add(category.kind);
  }

  for (const kind of STORAGE_SPACE_CATEGORY_ORDER) {
    if (!seen.has(kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `missing storage category: ${kind}`,
        path: ['categories'],
      });
    }
  }

  // Zod 在子字段已有 issue 时仍可能执行父级 superRefine；这里只在基础数值合同
  // 已成立后做精确求和，避免无效小数把“校验失败”变成 RangeError。
  const categorySizesAreValid = overview.categories.every(
    category => Number.isSafeInteger(category.byte_size) && category.byte_size >= 0,
  );
  const totalIsValid = Number.isSafeInteger(overview.total_byte_size)
    && overview.total_byte_size >= 0;
  const categoryTotal = categorySizesAreValid
    ? overview.categories.reduce(
      (total, category) => total + BigInt(category.byte_size),
      0n,
    )
    : null;
  if (
    categoryTotal !== null
    && totalIsValid
    && categoryTotal !== BigInt(overview.total_byte_size)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'total_byte_size must equal the sum of all storage categories',
      path: ['total_byte_size'],
    });
  }
});
export type StorageSpaceOverviewResponse = z.infer<
  typeof StorageSpaceOverviewResponseSchema
>;

export const StorageSpaceErrorCodeSchema = z.enum([
  'storage_space.invalid_conversation_id',
  'storage_space.conversation_not_found',
  'storage_space.conversation_deletion_in_progress',
  'storage_space.overview_failed',
  'storage_space.work_directory_clear_failed',
]);
export type StorageSpaceErrorCode = z.infer<typeof StorageSpaceErrorCodeSchema>;

export const StorageSpaceErrorResponseSchema = z.object({
  code: StorageSpaceErrorCodeSchema,
}).strict();
export type StorageSpaceErrorResponse = z.infer<typeof StorageSpaceErrorResponseSchema>;
