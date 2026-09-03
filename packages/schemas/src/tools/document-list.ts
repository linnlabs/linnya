import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

/** 旧版 resource_list 参数，只允许 Renderer 回放已落盘事件。 */
export const HistoricalResourceListArgsSchema = z.object({
  source: z.enum(['knowledge_base', 'shared_memory']),
  parent_id: NonEmptyStringSchema.optional(),
  mode: z.enum(['children', 'recent']).optional(),
  limit: PositiveIntegerSchema.optional(),
  offset: NonNegativeIntegerSchema.optional(),
}).strict();
export type HistoricalResourceListArgs = z.infer<typeof HistoricalResourceListArgsSchema>;

export const ListKnowledgeBaseArgsSchema = z.object({
  kb_id: NonEmptyStringSchema.optional(),
}).strict();

export const KnowledgeBaseListSummarySchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
}).strict();

export const KnowledgeBaseListDocumentSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  kb_id: NonEmptyStringSchema,
  kb_name: NonEmptyStringSchema.optional(),
}).strict();

const KnowledgeBaseListDataShape = {
  project_id: NonEmptyStringSchema,
  knowledge_bases: z.array(KnowledgeBaseListSummarySchema),
  documents: z.array(KnowledgeBaseListDocumentSchema),
  requested_kb_id: NonEmptyStringSchema.optional(),
};

export const ListKnowledgeBaseResultSchema = z.object({
  data: z.object(KnowledgeBaseListDataShape).strict(),
  observation: NonEmptyStringSchema,
}).strict();

/** 旧版 Resource Knowledge 列表结果，只允许 Renderer 回放已落盘事件。 */
export const HistoricalResourceKnowledgeBaseListResultSchema = z.object({
  data: z.object({
    source: z.literal('knowledge_base'),
    ...KnowledgeBaseListDataShape,
    total_count: NonNegativeIntegerSchema,
    has_more: z.boolean(),
    offset: NonNegativeIntegerSchema,
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export type KnowledgeBaseListDocument = z.infer<typeof KnowledgeBaseListDocumentSchema>;
export type ListKnowledgeBaseResult = z.infer<typeof ListKnowledgeBaseResultSchema>;
