import { z } from 'zod';

/**
 * 项目概览文件页“保存的筛选”：条件 + 布局，带稳定 ID，属于项目。
 * 是界面配置，不是用户内容：不进文档版本和行动账本。删了只是丢掉条件，文件不受影响。
 */
export const PROJECT_SAVED_FILTERS_CHANNEL = 'project-overview:saved-filters' as const;
/** 把字段条件换成满足条件的文档 ID；条件含义与 `linnya query` 同一份编译器。 */
export const PROJECT_OVERVIEW_MATCH_CHANNEL = 'project-overview:match' as const;
/** 看板拖动改值：写一个字段，经语义层按期望版本写入并记账。 */
export const PROJECT_OVERVIEW_SET_FIELD_CHANNEL = 'project-overview:set-field' as const;

export const PROJECT_SAVED_FILTER_DEFINITION_VERSION = 1;
export const PROJECT_SAVED_FILTER_NAME_MAX_LENGTH = 64;
/** Agent 建议多久没打开就自动清理。 */
export const PROJECT_SAVED_FILTER_SUGGESTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const ProjectOverviewModifiedRangeSchema = z.enum(['any', 'today', 'week', 'month']);

const FieldConditionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/** 一个字段条件，与 `SemanticQueryFilter` 同形；`field` 存字段 ID 或内建字段名，改名不失效。 */
export const ProjectFieldConditionSchema = z.object({
  field: z.string().trim().min(1),
  op: z.enum(['eq', 'neq', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty']),
  value: FieldConditionValueSchema.optional(),
}).strict();

export const ProjectSavedFilterDefinitionSchema = z.object({
  version: z.literal(PROJECT_SAVED_FILTER_DEFINITION_VERSION),
  /** 节点类型；null 为全部类型。 */
  node_type: z.string().min(1).nullable(),
  /** 相对时间，打开时按当天重新计算。 */
  modified: ProjectOverviewModifiedRangeSchema,
  /** 所在文件夹路径（含子文件夹）；null 为全部位置，空数组为根目录本身。 */
  location: z.array(z.string().min(1)).nullable(),
  /** 同时带有这些标签（ID）。 */
  tags: z.array(z.string().min(1)),
  /** 字段条件，全部同时成立。 */
  where: z.array(ProjectFieldConditionSchema),
  /** 界面列的排序；null 为默认（最近修改倒序）。 */
  sort: z.object({ key: z.string().min(1), direction: z.enum(['asc', 'desc']) }).strict().nullable(),
  /** 布局种类保持开放：以后加日历、卡片时新增种类，不改已有定义。 */
  layout: z.object({
    kind: z.enum(['table', 'board']),
    /** 看板按哪个单选字段分列（字段 ID）。 */
    group_by: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export const ProjectSavedFilterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 用户保存的，或 Agent 建的。 */
  origin: z.enum(['user', 'agent']),
  /** 固定在文件页那一排；Agent 主动建议的在用户点“固定”前为 false。 */
  pinned: z.boolean(),
  /** Agent 建的来自哪个对话；对话删除后为 null。 */
  conversation_id: z.string().min(1).nullable(),
  definition: ProjectSavedFilterDefinitionSchema,
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  last_opened_at: z.number().int().nonnegative(),
}).strict();

const ProjectId = z.string().trim().min(1);
const FilterName = z.string().trim().min(1).max(PROJECT_SAVED_FILTER_NAME_MAX_LENGTH);

export const ProjectSavedFiltersRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), project_id: ProjectId }).strict(),
  z.object({
    action: z.literal('create'), project_id: ProjectId, name: FilterName, definition: ProjectSavedFilterDefinitionSchema,
  }).strict(),
  z.object({
    action: z.literal('update'), project_id: ProjectId, id: z.string().min(1),
    name: FilterName.optional(), definition: ProjectSavedFilterDefinitionSchema.optional(), pinned: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal('delete'), project_id: ProjectId, id: z.string().min(1) }).strict(),
  z.object({ action: z.literal('open'), project_id: ProjectId, id: z.string().min(1) }).strict(),
]);

export const ProjectSavedFiltersResultSchema = z.object({
  /** 本项目全部保存的筛选：固定的按位置在前，建议在后。 */
  filters: z.array(ProjectSavedFilterSchema),
  /** 刚保存或改动的那一项。 */
  saved_id: z.string().min(1).nullable(),
}).strict();

export const ProjectOverviewMatchRequestSchema = z.object({
  project_id: ProjectId,
  where: z.array(ProjectFieldConditionSchema).min(1),
}).strict();

export const ProjectOverviewMatchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), document_ids: z.array(z.string().min(1)) }).strict(),
  /** 字段已删除、选项已不存在等：条件无法求值，界面显示原因，不当成“没有结果”。 */
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict(),
]);

export const ProjectOverviewSetFieldRequestSchema = z.object({
  project_id: ProjectId,
  document_id: z.string().trim().min(1),
  field_id: z.string().trim().min(1),
  /** null 为清空。 */
  value: FieldConditionValueSchema.nullable(),
  expected_revision: z.number().int().nonnegative(),
}).strict();

export const ProjectOverviewSetFieldResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), revision: z.number().int().nonnegative() }).strict(),
  z.object({ ok: z.literal(false), code: z.string().min(1), message: z.string().min(1) }).strict(),
]);

export type ProjectOverviewModifiedRangeValue = z.infer<typeof ProjectOverviewModifiedRangeSchema>;
export type ProjectFieldCondition = z.infer<typeof ProjectFieldConditionSchema>;
export type ProjectSavedFilterDefinition = z.infer<typeof ProjectSavedFilterDefinitionSchema>;
export type ProjectSavedFilter = z.infer<typeof ProjectSavedFilterSchema>;
export type ProjectSavedFiltersRequest = z.infer<typeof ProjectSavedFiltersRequestSchema>;
export type ProjectSavedFiltersResult = z.infer<typeof ProjectSavedFiltersResultSchema>;
export type ProjectOverviewMatchRequest = z.infer<typeof ProjectOverviewMatchRequestSchema>;
export type ProjectOverviewMatchResult = z.infer<typeof ProjectOverviewMatchResultSchema>;
export type ProjectOverviewSetFieldRequest = z.infer<typeof ProjectOverviewSetFieldRequestSchema>;
export type ProjectOverviewSetFieldResult = z.infer<typeof ProjectOverviewSetFieldResultSchema>;

function canonicalValue(value: ProjectFieldCondition['value']): unknown {
  return Array.isArray(value) ? [...value].sort() : value ?? null;
}

/**
 * 两个筛选“条件相同”的判据（保存时提示复用）：只比条件，不比排序和布局。
 * 标签与字段条件不计先后。
 */
export function projectSavedFilterConditionKey(definition: ProjectSavedFilterDefinition): string {
  return JSON.stringify({
    node_type: definition.node_type,
    modified: definition.modified,
    location: definition.location,
    tags: [...definition.tags].sort(),
    where: definition.where
      .map(condition => JSON.stringify([condition.field, condition.op, canonicalValue(condition.value)]))
      .sort(),
  });
}

/** 条件为空的定义就是“全部文件”。 */
export function isEmptyProjectSavedFilterConditions(definition: ProjectSavedFilterDefinition): boolean {
  return definition.node_type === null && definition.modified === 'any' && definition.location === null
    && definition.tags.length === 0 && definition.where.length === 0;
}
