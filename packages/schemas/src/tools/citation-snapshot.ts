import { z } from 'zod';
import {
  HistoricalKnowledgeSearchResultSchema,
  KnowledgeSearchCitationSchema,
} from './knowledge-search';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

export const CitationSnapshotBundleIdSchema = z.string().regex(/^[a-f0-9]{16}$/i);

export const CitationSnapshotBundleRecordV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('citation_snapshot'),
    created_at_ms: z.number().int().nonnegative(),
    conversation_id: NonEmptyStringSchema.optional(),
    turn_id: NonEmptyStringSchema.optional(),
    tool_call_id: NonEmptyStringSchema.optional(),
    tool_name: z.literal('search_knowledge_base'),
    query: NonEmptyStringSchema,
    args: z
      .object({
        doc_id: NonEmptyStringSchema.optional(),
        top_k: z.number().int().positive().optional(),
        deep_search: z.boolean().optional(),
      })
      .strict()
      .optional(),
    citations: z.array(KnowledgeSearchCitationSchema),
    result: HistoricalKnowledgeSearchResultSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.query !== record.result.data.query) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['result', 'data', 'query'],
        message: 'snapshot result query must match record query',
      });
    }
  });

export type CitationSnapshotBundleRecordV1 = z.infer<typeof CitationSnapshotBundleRecordV1Schema>;
