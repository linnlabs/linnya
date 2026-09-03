import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const SubrunBatchItemSchema = z.object({
  unit_id: NonEmptyStringSchema,
  subrun_id: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
}).strict();

export const SubrunBatchArgsSchema = z.object({
  worker_prompt_key: NonEmptyStringSchema,
  subruns: z.array(SubrunBatchItemSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateFieldIssues(value.subruns, 'unit_id', 'subruns', context);
  addDuplicateFieldIssues(value.subruns, 'subrun_id', 'subruns', context);
});

export const SubrunBatchResultStatusSchema = z.enum(['completed', 'failed', 'cancelled']);

export const SubrunBatchResultItemSchema = z.object({
  unit_id: NonEmptyStringSchema,
  subrun_id: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  status: SubrunBatchResultStatusSchema,
  final_answer: z.string(),
  error: NonEmptyStringSchema.optional(),
}).strict();

export const SubrunBatchDataSchema = z.object({
  status: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  total: z.number().int().positive(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  subrun_ids: z.array(NonEmptyStringSchema).min(1),
  results: z.array(SubrunBatchResultItemSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateFieldIssues(value.results, 'unit_id', 'results', context);
  addDuplicateFieldIssues(value.results, 'subrun_id', 'results', context);

  const orderedResultIds = value.results.map((item) => item.subrun_id);
  if (
    orderedResultIds.length !== value.subrun_ids.length
    || orderedResultIds.some((subrunId, index) => subrunId !== value.subrun_ids[index])
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subrun_ids'],
      message: 'subrun_ids must match results order',
    });
  }

  const succeeded = value.results.filter((item) => item.status === 'completed').length;
  const failed = value.results.filter((item) => item.status === 'failed').length;
  const cancelled = value.results.filter((item) => item.status === 'cancelled').length;
  if (
    value.total !== value.results.length
    || value.succeeded !== succeeded
    || value.failed !== failed
    || value.cancelled !== cancelled
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'subrun batch counters must match results',
    });
  }

  const expectedStatus = succeeded === value.results.length
    ? 'completed'
    : cancelled === value.results.length
      ? 'cancelled'
      : succeeded === 0 && failed > 0
        ? 'failed'
        : 'partial';
  if (value.status !== expectedStatus) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `subrun batch status must be ${expectedStatus}`,
    });
  }
});

export const SubrunBatchStructuredResultSchema = z.object({
  data: SubrunBatchDataSchema,
  observation: z.string(),
}).strict();

export type SubrunBatchItem = z.infer<typeof SubrunBatchItemSchema>;
export type SubrunBatchArgs = z.infer<typeof SubrunBatchArgsSchema>;
export type SubrunBatchResultStatus = z.infer<typeof SubrunBatchResultStatusSchema>;
export type SubrunBatchResultItem = z.infer<typeof SubrunBatchResultItemSchema>;
export type SubrunBatchData = z.infer<typeof SubrunBatchDataSchema>;
export type SubrunBatchStructuredResult = z.infer<typeof SubrunBatchStructuredResultSchema>;

export function readSubrunBatchArgs(value: unknown): SubrunBatchArgs | null {
  const result = SubrunBatchArgsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function readSubrunBatchData(value: unknown): SubrunBatchData | null {
  const result = SubrunBatchDataSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function readSubrunBatchStructuredResult(value: unknown): SubrunBatchStructuredResult | null {
  const result = SubrunBatchStructuredResultSchema.safeParse(value);
  return result.success ? result.data : null;
}

function addDuplicateFieldIssues<TKey extends string, T extends Record<TKey, string>>(
  items: readonly T[],
  field: TKey,
  collection: 'subruns' | 'results',
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const value = item[field];
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [collection, index, field],
        message: `${field} must be unique`,
      });
      return;
    }
    seen.add(value);
  });
}
