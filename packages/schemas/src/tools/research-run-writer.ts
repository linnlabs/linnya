import { z } from 'zod';
import { KnowledgeSearchCitationSchema } from './knowledge-search';
import { WebSearchCitationSchema } from './web-search';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

const ResearchWriterCitationSchema = z.union([
  KnowledgeSearchCitationSchema,
  WebSearchCitationSchema,
]);

/** 只接纳已经持久化的 Workspace-era Writer 事件，不参与 live 输出。 */
const HistoricalWorkspaceResearchRunWriterDataSchema = z.object({
  description: NonEmptyStringSchema,
  prompt_key: NonEmptyStringSchema,
  subrun_ids: z.array(NonEmptyStringSchema).min(1),
  inherit_turns: NonNegativeIntegerSchema,
  max_steps: PositiveIntegerSchema,
  success: z.boolean(),
  cancelled: z.literal(true).optional(),
  final_answer: z.string(),
  artifacts: z.array(NonEmptyStringSchema),
  document_refs_by_name: z.record(NonEmptyStringSchema),
  evidence_snapshot_generated: z.boolean(),
  evidence_snapshot_ref: NonEmptyStringSchema.optional(),
  evidence_snapshot_ref_count: NonNegativeIntegerSchema,
  citations: z.object({
    citations: z.array(ResearchWriterCitationSchema),
  }).strict().optional(),
  error: NonEmptyStringSchema.optional(),
}).strict().superRefine((data, context) => {
    const hasSnapshotRef = data.evidence_snapshot_ref !== undefined;
    if (data.evidence_snapshot_generated !== hasSnapshotRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence_snapshot_ref'],
        message: 'evidence snapshot ref presence must match evidence_snapshot_generated',
      });
    }
    if (data.evidence_snapshot_generated !== (data.evidence_snapshot_ref_count > 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence_snapshot_ref_count'],
        message: 'evidence snapshot count must match evidence_snapshot_generated',
      });
    }
    if ((data.citations?.citations.length ?? 0) !== data.evidence_snapshot_ref_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations'],
        message: 'writer citations must describe every evidence snapshot ref',
      });
    }
  });

/** 只用于接纳已经持久化的旧 SharedMemory writer 事件，不参与 live 输出。 */
export const HistoricalResearchRunWriterDataSchema = z.object({
  description: NonEmptyStringSchema,
  prompt_key: NonEmptyStringSchema,
  subrun_ids: z.array(NonEmptyStringSchema).min(1),
  inherit_turns: NonNegativeIntegerSchema,
  max_steps: PositiveIntegerSchema,
  success: z.boolean(),
  cancelled: z.literal(true).optional(),
  final_answer: z.string(),
  uris: z.array(NonEmptyStringSchema),
  doc_uris_by_name: z.record(NonEmptyStringSchema),
  evidence_snapshot_generated: z.boolean(),
  evidence_snapshot_uri: NonEmptyStringSchema.optional(),
  evidence_snapshot_uri_count: NonNegativeIntegerSchema,
  citations: z.object({
    citations: z.array(ResearchWriterCitationSchema),
  }).strict().optional(),
  error: NonEmptyStringSchema.optional(),
}).strict();

/**
 * Writer 的持久化/回放结果不包含执行期 control；引用和 UI 消费者只依赖这份稳定合同。
 */
const HistoricalWorkspaceResearchRunWriterReplayResultSchema = z.object({
  data: HistoricalWorkspaceResearchRunWriterDataSchema,
  observation: NonEmptyStringSchema,
}).strict();

const HistoricalResearchRunWriterReplayResultSchema = z.object({
  data: HistoricalResearchRunWriterDataSchema,
  observation: NonEmptyStringSchema,
}).strict();

export const ResearchRunWriterReplayResultSchema = z.union([
  HistoricalWorkspaceResearchRunWriterReplayResultSchema,
  HistoricalResearchRunWriterReplayResultSchema,
]);

export type ResearchRunWriterReplayResult = z.infer<typeof ResearchRunWriterReplayResultSchema>;
