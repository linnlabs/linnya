import {
  PROJECT_SAVED_FILTER_DEFINITION_VERSION,
  projectSavedFilterConditionKey,
  type ProjectFieldCondition,
  type ProjectOverviewField,
  type ProjectSavedFilter,
  type ProjectSavedFilterDefinition,
} from '@app/schemas';
import {
  DEFAULT_PROJECT_OVERVIEW_SORT,
  DEFAULT_PROJECT_OVERVIEW_VIEW,
  EMPTY_PROJECT_OVERVIEW_FILTERS,
  PROJECT_OVERVIEW_COLUMN_IDS,
  type ProjectOverviewFilters,
  type ProjectOverviewSort,
  type ProjectOverviewSortKey,
  type ProjectOverviewView,
} from '../definitions/projectOverview';

/** “全部文件”不是保存的筛选，用这个 ID 占位。 */
export const ALL_FILES_FILTER_ID = '__all_files__';

/** 文件页那一排最多直接显示几项保存的筛选，其余收进“更多”。 */
export const MAX_VISIBLE_SAVED_FILTERS = 5;

export interface ProjectOverviewFileView {
  readonly filters: ProjectOverviewFilters;
  readonly sort: ProjectOverviewSort;
  readonly view: ProjectOverviewView;
}

const SORT_KEYS: readonly string[] = ['name', ...PROJECT_OVERVIEW_COLUMN_IDS];
const isSortKey = (key: string): key is ProjectOverviewSortKey => SORT_KEYS.includes(key);

function sameSort(left: ProjectOverviewSort, right: ProjectOverviewSort): boolean {
  return left.key === right.key && left.direction === right.direction;
}

/** 界面当前状态 → 保存的定义。搜索不进定义；默认排序存成 null。 */
export function savedFilterDefinitionFrom(state: ProjectOverviewFileView): ProjectSavedFilterDefinition {
  return {
    version: PROJECT_SAVED_FILTER_DEFINITION_VERSION,
    node_type: state.filters.nodeType,
    modified: state.filters.modified,
    location: state.filters.location === null ? null : [...state.filters.location],
    tags: [...state.filters.tags],
    where: [...state.filters.where],
    sort: sameSort(state.sort, DEFAULT_PROJECT_OVERVIEW_SORT) ? null : { key: state.sort.key, direction: state.sort.direction },
    layout: { kind: state.view.kind, group_by: state.view.kind === 'board' ? state.view.groupBy : null },
  };
}

/** 保存的定义 → 界面状态。界面不认识的排序列按默认排序处理。 */
export function fileViewFromSavedFilter(definition: ProjectSavedFilterDefinition, query: string): ProjectOverviewFileView {
  const sort = definition.sort !== null && isSortKey(definition.sort.key)
    ? { key: definition.sort.key, direction: definition.sort.direction }
    : DEFAULT_PROJECT_OVERVIEW_SORT;
  return {
    filters: {
      nodeType: definition.node_type,
      modified: definition.modified,
      location: definition.location,
      tags: definition.tags,
      where: definition.where,
      query,
    },
    sort,
    view: { kind: definition.layout.kind, groupBy: definition.layout.group_by },
  };
}

/** “全部文件”的状态：没有条件、默认排序、表格。 */
export function allFilesView(query: string): ProjectOverviewFileView {
  return { filters: { ...EMPTY_PROJECT_OVERVIEW_FILTERS, query }, sort: DEFAULT_PROJECT_OVERVIEW_SORT, view: DEFAULT_PROJECT_OVERVIEW_VIEW };
}

/** 当前状态与所选那一项是否不同（“已改动”/出现“保存筛选”）：比条件、排序与布局，不比搜索。 */
export function isSavedFilterChanged(current: ProjectSavedFilterDefinition, baseline: ProjectSavedFilterDefinition): boolean {
  return projectSavedFilterConditionKey(current) !== projectSavedFilterConditionKey(baseline)
    || JSON.stringify(current.sort) !== JSON.stringify(baseline.sort)
    || current.layout.kind !== baseline.layout.kind
    || (current.layout.kind === 'board' && current.layout.group_by !== baseline.layout.group_by);
}

/** 已保存过条件相同的筛选（保存时提示复用）。 */
export function findSameConditions(
  filters: readonly ProjectSavedFilter[],
  definition: ProjectSavedFilterDefinition,
): ProjectSavedFilter | null {
  const key = projectSavedFilterConditionKey(definition);
  return filters.find(filter => projectSavedFilterConditionKey(filter.definition) === key) ?? null;
}

/** 那一排：固定的按顺序，超过上限的收进“更多”；正在看的那项在“更多”里时换到最后一个位置。 */
export function arrangeSavedFilters(
  pinned: readonly ProjectSavedFilter[],
  activeId: string,
  limit = MAX_VISIBLE_SAVED_FILTERS,
): { readonly visible: readonly ProjectSavedFilter[]; readonly overflow: readonly ProjectSavedFilter[] } {
  if (pinned.length <= limit) return { visible: pinned, overflow: [] };
  const visible = pinned.slice(0, limit);
  const overflow = pinned.slice(limit);
  const activeIndex = overflow.findIndex(filter => filter.id === activeId);
  if (activeIndex < 0) return { visible, overflow };
  const active = overflow[activeIndex];
  const displaced = visible[visible.length - 1];
  return {
    visible: [...visible.slice(0, -1), active],
    overflow: [displaced, ...overflow.filter(filter => filter.id !== activeId)],
  };
}

export interface FieldConditionLabels {
  readonly fieldName: (fieldId: string) => string | null;
  readonly builtinName: (field: string) => string | null;
  readonly unknownField: string;
  readonly checked: string;
  readonly unchecked: string;
  readonly empty: string;
  readonly notEmpty: string;
  readonly negated: (value: string) => string;
  readonly contains: (value: string) => string;
  readonly notContains: (value: string) => string;
  readonly join: string;
  readonly pair: (label: string, value: string) => string;
}

/** 选项显示名；字段已删除或选项已不存在时原样显示 ID。 */
function valueText(field: ProjectOverviewField | undefined, value: ProjectFieldCondition['value'], labels: FieldConditionLabels): string {
  if (value === undefined) return '';
  const option = (id: string) => field?.options.find(candidate => candidate.id === id)?.name ?? id;
  if (Array.isArray(value)) return value.map(option).join(labels.join);
  if (typeof value === 'boolean') return value ? labels.checked : labels.unchecked;
  if (typeof value === 'string' && (field?.value_type === 'select' || field?.value_type === 'multi_select')) return option(value);
  return String(value);
}

/** 工具条上一个字段条件的文字，如“已读：未勾选”“年份 ≥ 2017”。 */
export function fieldConditionText(
  condition: ProjectFieldCondition,
  fields: readonly ProjectOverviewField[],
  labels: FieldConditionLabels,
): string {
  const field = fields.find(candidate => candidate.id === condition.field);
  const name = labels.builtinName(condition.field) ?? labels.fieldName(condition.field) ?? labels.unknownField;
  const value = valueText(field, condition.value, labels);
  switch (condition.op) {
    case 'eq':
      // 勾选的“未勾选”含未设置，直接说“未勾选”。
      return labels.pair(name, value);
    case 'neq': return labels.pair(name, labels.negated(value));
    case 'contains': return labels.pair(name, labels.contains(value));
    case 'not_contains': return labels.pair(name, labels.notContains(value));
    case 'empty': return labels.pair(name, labels.empty);
    case 'not_empty': return labels.pair(name, labels.notEmpty);
    case 'gt': return `${name} > ${value}`;
    case 'gte': return `${name} ≥ ${value}`;
    case 'lt': return `${name} < ${value}`;
    case 'lte': return `${name} ≤ ${value}`;
  }
}

/** 保存时的默认名称：把条件连起来；没有条件时由调用方给出（如“看板”）。 */
export function defaultSavedFilterName(parts: readonly (string | null)[], fallback: string, maxLength = 64): string {
  const name = parts.filter((part): part is string => part !== null && part.trim().length > 0).join(' · ');
  return (name || fallback).slice(0, maxLength);
}
