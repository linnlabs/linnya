import { z } from 'zod';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

export const AssembleDocumentsArgsSchema = z
  .object({
    query: NonEmptyStringSchema,
    selected_blocks: z.array(
      z
        .object({
          doc_id: NonEmptyStringSchema,
          block_id: NonEmptyStringSchema,
        })
        .strict()
    ),
    summary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const AssembleDocumentsKeptItemSchema = z
  .object({
    doc_id: NonEmptyStringSchema,
    block_id: NonEmptyStringSchema,
    snippet: z.string(),
    doc_name: NonEmptyStringSchema,
  })
  .strict();

export const AssembleDocumentsDroppedItemSchema = z
  .object({
    doc_id: NonEmptyStringSchema,
    block_id: NonEmptyStringSchema,
  })
  .strict();

export const AssembleDocumentsResultDataSchema = z
  .object({
    query: NonEmptyStringSchema,
    summary: NonEmptyStringSchema.optional(),
    kept: z.array(AssembleDocumentsKeptItemSchema),
    dropped: z.array(AssembleDocumentsDroppedItemSchema),
    stats: z
      .object({
        total_input: z.number().int().nonnegative(),
        kept_count: z.number().int().nonnegative(),
        dropped_count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.kept.length !== data.stats.kept_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stats', 'kept_count'],
        message: 'kept_count must match kept.length',
      });
    }
    if (data.dropped.length !== data.stats.dropped_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stats', 'dropped_count'],
        message: 'dropped_count must match dropped.length',
      });
    }
    if (data.stats.total_input !== data.kept.length + data.dropped.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stats', 'total_input'],
        message: 'total_input must match kept and dropped counts',
      });
    }
  });

export const AssembleDocumentsToolOutputSchema = z
  .object({
    data: AssembleDocumentsResultDataSchema,
    observation: NonEmptyStringSchema,
    control: z
      .object({
        terminateRun: z.literal(true),
        reason: NonEmptyStringSchema,
      })
      .strict(),
  })
  .strict();

export type AssembleDocumentsArgs = z.infer<typeof AssembleDocumentsArgsSchema>;
export type AssembleDocumentsResultData = z.infer<typeof AssembleDocumentsResultDataSchema>;
export type AssembleDocumentsKeptItem = z.infer<typeof AssembleDocumentsKeptItemSchema>;
export type AssembleDocumentsDroppedItem = z.infer<typeof AssembleDocumentsDroppedItemSchema>;
