import { z } from 'zod';
import { CitationRefSchema } from '../citation';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const EvidenceBundleIdSchema = z.string().regex(/^[a-f0-9]{16}$/i);

const HistoricalSelectedBlockSchema = z
  .object({
    doc_id: NonEmptyStringSchema,
    block_id: NonEmptyStringSchema,
  })
  .strict();

/** 仅用于 Renderer 严格回放已持久化的 assemble_evidence 事件。 */
export const HistoricalAssembleEvidenceArgsSchema = z
  .object({
    query: NonEmptyStringSchema,
    selected_refs: z.array(NonEmptyStringSchema).optional(),
    selected_blocks: z.array(HistoricalSelectedBlockSchema).optional(),
  })
  .strict();

export const HistoricalAssembleEvidenceResultDataSchema = z
  .object({
    version: z.literal(1),
    query: NonEmptyStringSchema,
    kept: z.array(
      z
        .object({
          doc_id: NonEmptyStringSchema,
          block_id: NonEmptyStringSchema,
          ref_id: CitationRefSchema,
        })
        .strict()
    ),
    stats: z
      .object({
        total_input: z.number().int().nonnegative(),
        kept_count: z.number().int().nonnegative(),
        dropped_count: z.number().int().nonnegative(),
      })
      .strict(),
    evidence_store: z
      .object({
        bundle_id: EvidenceBundleIdSchema,
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
    if (data.stats.total_input !== data.stats.kept_count + data.stats.dropped_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stats', 'total_input'],
        message: 'total_input must match kept and dropped counts',
      });
    }
  });

export const HistoricalAssembleEvidenceToolOutputSchema = z
  .object({
    data: HistoricalAssembleEvidenceResultDataSchema,
    observation: NonEmptyStringSchema,
  })
  .strict();

export type HistoricalAssembleEvidenceArgs = z.infer<typeof HistoricalAssembleEvidenceArgsSchema>;
export type HistoricalAssembleEvidenceResultData = z.infer<
  typeof HistoricalAssembleEvidenceResultDataSchema
>;
