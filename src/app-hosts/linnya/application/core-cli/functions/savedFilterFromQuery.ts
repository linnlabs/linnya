import {
  PROJECT_SAVED_FILTER_DEFINITION_VERSION,
  type ProjectFieldCondition,
  type ProjectSavedFilterDefinition,
} from '@app/schemas';
import {
  SEMANTIC_QUERY_BUILTIN_FIELDS,
  semanticNameKey,
  type SemanticPropertyDefinition,
  type SemanticQueryFilter,
  type SemanticQuerySort,
  type SemanticTagDefinition,
} from 'src/domains/semantic-layer';

/** 查询里的内建排序字段对应文件页的哪一列；字段排序界面暂不支持，保存时不带。 */
const SORT_COLUMNS: Readonly<Record<string, string>> = { name: 'name', updated: 'modified', created: 'created' };

function keyOf(raw: string): string | null {
  try {
    return semanticNameKey(raw);
  } catch {
    return null;
  }
}

/**
 * 把一次（已经执行成功的）查询换成保存的筛选定义：标签、字段、选项都换成 ID，改名后筛选不失效。
 * 按单选字段分组时保存为看板，按它分列。
 */
export function savedFilterFromQuery(input: {
  readonly tags: readonly string[];
  readonly where: readonly SemanticQueryFilter[];
  readonly sort: readonly SemanticQuerySort[];
  readonly groupBy: string | null;
  readonly tagDefinitions: readonly SemanticTagDefinition[];
  readonly properties: readonly SemanticPropertyDefinition[];
}): ProjectSavedFilterDefinition {
  const property = (raw: string) => input.properties.find(candidate => candidate.id === raw)
    ?? input.properties.find(candidate => semanticNameKey(candidate.name) === keyOf(raw));
  const optionId = (definition: SemanticPropertyDefinition, value: string) => definition.options.find(option => option.id === value)?.id
    ?? definition.options.find(option => semanticNameKey(option.name) === keyOf(value))?.id
    ?? value;
  const where = input.where.map((filter): ProjectFieldCondition => {
    if (SEMANTIC_QUERY_BUILTIN_FIELDS.some(name => name === filter.field)) {
      return { field: filter.field, op: filter.op, ...(filter.value === undefined ? {} : { value: filter.value as ProjectFieldCondition['value'] }) };
    }
    const definition = property(filter.field);
    if (!definition) throw new Error(`没有字段“${filter.field}”`);
    let value = filter.value as ProjectFieldCondition['value'];
    if ((definition.valueType === 'select' || definition.valueType === 'multi_select') && value !== undefined) {
      value = Array.isArray(value) ? value.map(item => optionId(definition, item)) : typeof value === 'string' ? optionId(definition, value) : value;
    }
    return { field: definition.id, op: filter.op, ...(value === undefined ? {} : { value }) };
  });
  const tags = input.tags.map(raw => (input.tagDefinitions.find(tag => tag.id === raw)
    ?? input.tagDefinitions.find(tag => semanticNameKey(tag.name) === keyOf(raw)))?.id ?? raw);
  const group = input.groupBy ? property(input.groupBy) : undefined;
  const firstSort = input.sort.find(sort => SORT_COLUMNS[sort.field] !== undefined);
  return {
    version: PROJECT_SAVED_FILTER_DEFINITION_VERSION,
    node_type: null,
    modified: 'any',
    location: null,
    tags: [...new Set(tags)],
    where,
    sort: firstSort ? { key: SORT_COLUMNS[firstSort.field], direction: firstSort.direction } : null,
    layout: group?.valueType === 'select' ? { kind: 'board', group_by: group.id } : { kind: 'table', group_by: null },
  };
}
