import { z } from 'zod';

/**
 * 标签管理：改名、合并、删除标签，改名、删除字段，改字段类型，编辑选项；每次改动一批，可整批撤回。
 * 标签和字段是整个工作区共用的，改动影响所有项目；保存的筛选随之在同一事务里改写，撤回时一起恢复。
 */
export const SEMANTIC_SCHEMA_MANAGE_CHANNEL = 'semantic-schema:manage' as const;

export const SemanticValueTypeSchema = z.enum([
  'text', 'number', 'date', 'datetime', 'checkbox', 'select', 'multi_select', 'url',
]);

const Ref = z.string().trim().min(1);
const Name = z.string().trim().min(1);

/** 标签、字段可写 ID 或名称；界面传 ID，命令行传名称。 */
export const SemanticSchemaOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename_tag'), tag: Ref, name: Name, allow_similar: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('merge_tags'), source: Ref, target: Ref }).strict(),
  z.object({ op: z.literal('delete_tag'), tag: Ref }).strict(),
  z.object({ op: z.literal('rename_property'), property: Ref, name: Name, allow_similar: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('delete_property'), property: Ref }).strict(),
  z.object({ op: z.literal('change_property_type'), property: Ref, value_type: SemanticValueTypeSchema }).strict(),
  /** 带 ID 的是已有选项（可改名、调顺序），不带的是新选项，没列出的删除。 */
  z.object({
    op: z.literal('update_options'), property: Ref,
    options: z.array(z.object({ id: z.string().min(1).optional(), name: Name }).strict()).min(1),
  }).strict(),
]);

export const SemanticSchemaManageRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('usage'), kind: z.enum(['tag', 'property']), id: Ref }).strict(),
  z.object({ action: z.literal('preview'), operation: SemanticSchemaOperationSchema }).strict(),
  z.object({ action: z.literal('apply'), operation: SemanticSchemaOperationSchema }).strict(),
  z.object({ action: z.literal('undo'), change_id: Ref }).strict(),
  /** 整体替换标签带的字段（按给出的顺序）。值不迁移、不删除，不记改动批次：字段移回来值就回来。 */
  z.object({ action: z.literal('set_tag_fields'), tag: Ref, field_ids: z.array(z.string().min(1)) }).strict(),
]);

const Count = z.number().int().nonnegative();
const Time = z.number().int().nonnegative();
const Named = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();

/** 谁做的：Agent 带对话和 Agent ID；对话删除后标题为 null。 */
export const SemanticSchemaActorSchema = z.object({
  kind: z.enum(['user', 'run', 'subrun', 'plugin', 'external']),
  conversation_id: z.string().min(1).nullable(),
  conversation_title: z.string().nullable(),
  agent_id: z.string().min(1).nullable(),
}).strict();

export const SemanticSchemaTagItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 不在回收站的文档，所有项目合计。 */
  document_count: Count,
  /** 名称相近的其他标签，可能是同一类。 */
  similar: z.array(Named),
  field_ids: z.array(z.string().min(1)),
  created_at: Time,
  /** 迁移前建的没有记录。 */
  created_by: SemanticSchemaActorSchema.nullable(),
}).strict();

export const SemanticSchemaPropertyItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value_type: SemanticValueTypeSchema,
  options: z.array(Named),
  /** 插件声明的字段只读。 */
  owner_plugin_id: z.string().min(1).nullable(),
  /** 带这个字段的标签。 */
  tag_ids: z.array(z.string().min(1)),
  /** 填了值的文档（不在回收站）。 */
  document_count: Count,
}).strict();

export const SemanticSchemaChangeSummarySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rename_tag'), from: z.string(), to: z.string() }).strict(),
  z.object({ kind: z.literal('merge_tags'), source: z.string(), target: z.string(), objects: Count }).strict(),
  z.object({ kind: z.literal('delete_tag'), tag: z.string(), objects: Count }).strict(),
  z.object({ kind: z.literal('rename_property'), from: z.string(), to: z.string() }).strict(),
  z.object({ kind: z.literal('delete_property'), property: z.string() }).strict(),
  z.object({
    kind: z.literal('change_property_type'), property: z.string(),
    fromType: SemanticValueTypeSchema, toType: SemanticValueTypeSchema, objects: Count, failed: Count,
  }).strict(),
  z.object({
    kind: z.literal('update_options'), property: z.string(), added: z.array(z.string()),
    renamed: z.array(z.object({ from: z.string(), to: z.string() }).strict()), removed: z.array(z.string()), objects: Count,
  }).strict(),
]);

export const SemanticSchemaChangeItemSchema = z.object({
  id: z.string().min(1),
  summary: SemanticSchemaChangeSummarySchema,
  actor: SemanticSchemaActorSchema,
  /** 随这批改动改写的保存的筛选个数。 */
  saved_filter_count: Count,
  created_at: Time,
  undone_at: Time.nullable(),
}).strict();

export const SemanticSchemaOverviewSchema = z.object({
  tags: z.array(SemanticSchemaTagItemSchema),
  properties: z.array(SemanticSchemaPropertyItemSchema),
  /** 最近的改动，新的在前。 */
  changes: z.array(SemanticSchemaChangeItemSchema),
}).strict();

const DocumentItem = z.object({
  id: z.string().min(1),
  title: z.string(),
  node_type: z.string().min(1),
  project_id: z.string().min(1).nullable(),
}).strict();

const SavedFilterItem = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project_id: z.string().min(1),
  project_name: z.string(),
  layout: z.enum(['table', 'board']),
}).strict();

export const SemanticSchemaUsageSchema = z.object({
  projects: z.array(z.object({ id: z.string().min(1), name: z.string(), document_count: Count }).strict()),
  /** 按项目、名称排列，最多 200 份。 */
  documents: z.array(DocumentItem),
  saved_filters: z.array(SavedFilterItem),
}).strict();

const ConversionSample = z.object({
  document: DocumentItem,
  from: z.string(),
  to: z.string().nullable(),
}).strict();

/** 执行前的影响范围；不写库。 */
export const SemanticSchemaPreviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tag'),
    /** 带来源标签、不在回收站的文档。 */
    documents: Count,
    /** 合并时已经带有目标标签的文档。 */
    already_target: Count,
    /** 合并时目标标签要加上的字段名。 */
    added_fields: z.array(z.string()),
    saved_filters: z.array(SavedFilterItem),
  }).strict(),
  z.object({
    kind: z.literal('type'),
    total: Count, converted: Count, failed: Count, emptied: Count,
    to_options: z.array(Named),
    samples: z.object({ converted: z.array(ConversionSample), failed: z.array(ConversionSample), emptied: z.array(ConversionSample) }).strict(),
    saved_filters: z.array(SavedFilterItem),
  }).strict(),
  z.object({
    kind: z.literal('options'),
    removed: z.array(z.string()),
    /** 用到被删选项的文档。 */
    documents: Count,
    saved_filters: z.array(SavedFilterItem),
  }).strict(),
  z.object({ kind: z.literal('simple'), saved_filters: z.array(SavedFilterItem) }).strict(),
]);

const Failure = z.object({
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string().min(1),
  /** 名称相近时的候选。 */
  candidates: z.array(Named).optional(),
}).strict();

export const SemanticSchemaManageResultSchema = z.union([
  z.object({ ok: z.literal(true), action: z.literal('read'), overview: SemanticSchemaOverviewSchema }).strict(),
  z.object({ ok: z.literal(true), action: z.literal('usage'), usage: SemanticSchemaUsageSchema }).strict(),
  z.object({ ok: z.literal(true), action: z.literal('preview'), preview: SemanticSchemaPreviewSchema }).strict(),
  z.object({ ok: z.literal(true), action: z.literal('apply'), change: SemanticSchemaChangeItemSchema, overview: SemanticSchemaOverviewSchema }).strict(),
  z.object({ ok: z.literal(true), action: z.literal('set_tag_fields'), overview: SemanticSchemaOverviewSchema }).strict(),
  z.object({
    ok: z.literal(true), action: z.literal('undo'), change: SemanticSchemaChangeItemSchema, overview: SemanticSchemaOverviewSchema,
    /** 之后又被改过的保存的筛选不恢复。 */
    saved_filters_skipped: Count,
  }).strict(),
  Failure,
]);

export type SemanticValueTypeValue = z.infer<typeof SemanticValueTypeSchema>;
export type SemanticSchemaOperation = z.infer<typeof SemanticSchemaOperationSchema>;
export type SemanticSchemaManageRequest = z.infer<typeof SemanticSchemaManageRequestSchema>;
export type SemanticSchemaActor = z.infer<typeof SemanticSchemaActorSchema>;
export type SemanticSchemaTagItem = z.infer<typeof SemanticSchemaTagItemSchema>;
export type SemanticSchemaPropertyItem = z.infer<typeof SemanticSchemaPropertyItemSchema>;
export type SemanticSchemaChangeSummaryValue = z.infer<typeof SemanticSchemaChangeSummarySchema>;
export type SemanticSchemaChangeItem = z.infer<typeof SemanticSchemaChangeItemSchema>;
export type SemanticSchemaOverview = z.infer<typeof SemanticSchemaOverviewSchema>;
export type SemanticSchemaUsage = z.infer<typeof SemanticSchemaUsageSchema>;
export type SemanticSchemaPreview = z.infer<typeof SemanticSchemaPreviewSchema>;
export type SemanticSchemaManageResult = z.infer<typeof SemanticSchemaManageResultSchema>;
