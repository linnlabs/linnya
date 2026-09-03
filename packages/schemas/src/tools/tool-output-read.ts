import { z } from 'zod';

export const ToolOutputBlobIdSchema = z.string().regex(
  /^[a-f0-9]{16}$/i,
  '非法 blob_id（要求 16 位十六进制）',
);
export type ToolOutputBlobId = z.infer<typeof ToolOutputBlobIdSchema>;

export function parseToolOutputBlobId(value: unknown): ToolOutputBlobId {
  return ToolOutputBlobIdSchema.parse(value);
}

const ToolOutputReadDataBaseSchema = z.object({
  blob_id: ToolOutputBlobIdSchema,
  start_offset: z.number().int().nonnegative(),
  end_offset_exclusive: z.number().int().positive(),
  total_chars: z.number().int().positive(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  total_lines: z.number().int().positive(),
  has_more: z.boolean(),
  next_offset: z.number().int().positive().nullable(),
  window_text: z.string(),
}).strict();

type ToolOutputReadDataBase = z.infer<typeof ToolOutputReadDataBaseSchema>;

function validateToolOutputReadData(
  data: ToolOutputReadDataBase,
  context: z.RefinementCtx,
): void {
  if (data.start_line > data.end_line || data.end_line > data.total_lines) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tool output line range is invalid',
    });
  }
  if (
    data.start_offset >= data.end_offset_exclusive
    || data.end_offset_exclusive > data.total_chars
    || data.end_offset_exclusive - data.start_offset !== data.window_text.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_offset_exclusive'],
      message: 'tool output character range must exactly match window_text',
    });
  }
  const expectedHasMore = data.end_offset_exclusive < data.total_chars;
  const expectedNextOffset = expectedHasMore ? data.end_offset_exclusive : null;
  if (data.has_more !== expectedHasMore || data.next_offset !== expectedNextOffset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'tool output cursor must equal the first unread character offset',
    });
  }
}

export const ToolOutputReadDataSchema = ToolOutputReadDataBaseSchema.superRefine(
  validateToolOutputReadData,
);

export const ToolOutputReadResultSchema = z.object({
  data: ToolOutputReadDataSchema,
  observation: z.string().trim().min(1),
}).strict();

/** 历史 resource_read(tool_output://...) 结果的 replay admission 合同。 */
export const HistoricalToolOutputResourceReadDataSchema = ToolOutputReadDataBaseSchema.extend({
  uri: z.string().regex(/^tool_output:\/\/blobs\/[a-f0-9]{16}$/i),
  source: z.literal('tool_output'),
}).strict().superRefine(validateToolOutputReadData);

export const HistoricalToolOutputResourceReadResultSchema = z.object({
  data: HistoricalToolOutputResourceReadDataSchema,
  observation: z.string().trim().min(1),
}).strict();

export type ToolOutputReadData = z.infer<typeof ToolOutputReadDataSchema>;
export type ToolOutputReadResult = z.infer<typeof ToolOutputReadResultSchema>;
export type HistoricalToolOutputResourceReadResult = z.infer<
  typeof HistoricalToolOutputResourceReadResultSchema
>;

export function parseToolOutputReadResult(value: unknown): ToolOutputReadResult {
  return ToolOutputReadResultSchema.parse(value);
}
