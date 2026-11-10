import {
  SemanticLayerError,
  type SemanticPropertyDefinition,
  type SemanticTagDefinition,
} from '../../../definitions/semanticLayer';
import { semanticNameKey } from '../../../functions/normalizeSemanticName';
import {
  SEMANTIC_QUERY_BUILTIN_FIELDS,
  SEMANTIC_QUERY_MAX_LIMIT,
  type SemanticQuery,
  type SemanticQueryBuiltinField,
  type SemanticQueryFilter,
} from '../definitions/semanticQuery';

export interface SemanticQueryDefinitions {
  readonly tags: readonly SemanticTagDefinition[];
  readonly properties: readonly SemanticPropertyDefinition[];
}

export interface CompiledSemanticQuery {
  /** `FROM … WHERE …`，行查询、计数与分组共用。 */
  readonly from: string;
  readonly params: readonly unknown[];
  readonly orderBy: string;
  readonly orderParams: readonly unknown[];
  readonly group?: {
    readonly select: string;
    readonly params: readonly unknown[];
    readonly kind: 'value' | 'checkbox' | 'multi' | 'type';
  };
  readonly limit: number;
}

type Field =
  | { readonly kind: 'builtin'; readonly name: SemanticQueryBuiltinField }
  | { readonly kind: 'property'; readonly property: SemanticPropertyDefinition };

const BUILTIN_COLUMNS: Record<SemanticQueryBuiltinField, string> = {
  name: 'node.name', type: 'node.type', created: 'node.created_at', updated: 'node.updated_at',
};

function queryError(message: string, details?: Record<string, unknown>): never {
  throw new SemanticLayerError('invalid_query', message, details);
}

/** 字段 ID 由语义层生成；内联进 SQL 前再核对字符集，杜绝注入。 */
function safeId(property: SemanticPropertyDefinition): string {
  if (!/^[A-Za-z0-9_-]+$/.test(property.id)) throw new Error(`字段 ID 含非法字符：${property.id}`);
  return property.id;
}

function valueOf(property: SemanticPropertyDefinition): string {
  return `(value.property_values ->> '$."${safeId(property)}"')`;
}

/** 字段只对“当前标签带着它”的对象生效；去掉标签后保留的旧值不参与筛选、排序和分组。 */
function availableFor(property: SemanticPropertyDefinition): string {
  return `EXISTS (
    SELECT 1 FROM semantic_object_tags available_tag
    JOIN semantic_tags available_definition
      ON available_definition.id = available_tag.tag_id AND available_definition.deleted_at IS NULL
    JOIN semantic_tag_fields available_field
      ON available_field.tag_id = available_tag.tag_id AND available_field.property_id = '${safeId(property)}'
    WHERE available_tag.object_kind = 'document' AND available_tag.object_id = node.id
  )`;
}

function localDayStart(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function optionIds(property: SemanticPropertyDefinition, value: SemanticQueryFilter['value']): string[] {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length) queryError(`字段“${property.name}”的条件需要选项`);
  return values.map(raw => {
    const option = typeof raw === 'string'
      ? property.options.find(candidate => candidate.id === raw) ??
        property.options.find(candidate => candidate.name.normalize('NFKC').toLowerCase() === raw.normalize('NFKC').trim().toLowerCase())
      : undefined;
    if (!option) {
      queryError(`字段“${property.name}”没有选项“${String(raw)}”`, { options: property.options.map(item => item.name) });
    }
    return option.id;
  });
}

function requireValue<T>(filter: SemanticQueryFilter, check: (value: unknown) => value is T, expected: string): T {
  if (!check(filter.value)) queryError(`条件“${filter.field} ${filter.op}”需要${expected}`);
  return filter.value;
}
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const COMPARE: Record<string, string> = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function unsupported(field: string, op: string, type: string): never {
  queryError(`字段“${field}”（${type}）不支持条件 ${op}`);
}

/** 文字比较不分大小写：两边都经 NFKC 与大小写折叠（semantic_fold，与名称唯一性同一规则）。 */
function textCondition(expression: string, filter: SemanticQueryFilter, label: string, type: string): [string, unknown[]] {
  switch (filter.op) {
    case 'empty': return [`${expression} IS NULL`, []];
    case 'not_empty': return [`${expression} IS NOT NULL`, []];
    case 'eq': return [`semantic_fold(${expression}) = semantic_fold(?)`, [requireValue(filter, isString, '文字')]];
    case 'neq': return [`(${expression} IS NULL OR semantic_fold(${expression}) <> semantic_fold(?))`, [requireValue(filter, isString, '文字')]];
    case 'contains': return [`instr(semantic_fold(${expression}), semantic_fold(?)) > 0`, [requireValue(filter, isString, '文字')]];
    case 'not_contains': return [`(${expression} IS NULL OR instr(semantic_fold(${expression}), semantic_fold(?)) = 0)`, [requireValue(filter, isString, '文字')]];
    default: return unsupported(label, filter.op, type);
  }
}

function orderedCondition(
  expression: string, filter: SemanticQueryFilter, label: string, type: string, value: () => unknown, wrap = (sql: string) => sql
): [string, unknown[]] {
  switch (filter.op) {
    case 'empty': return [`${expression} IS NULL`, []];
    case 'not_empty': return [`${expression} IS NOT NULL`, []];
    case 'neq': return [`(${expression} IS NULL OR ${wrap(expression)} <> ${wrap('?')})`, [value()]];
    case 'eq': case 'gt': case 'gte': case 'lt': case 'lte':
      return [`${wrap(expression)} ${COMPARE[filter.op]} ${wrap('?')}`, [value()]];
    default: return unsupported(label, filter.op, type);
  }
}

function propertyCondition(property: SemanticPropertyDefinition, filter: SemanticQueryFilter): [string, unknown[]] {
  const expression = valueOf(property);
  const scoped = ([sql, params]: [string, unknown[]]): [string, unknown[]] => [`(${availableFor(property)} AND ${sql})`, params];
  const name = property.name;
  switch (property.valueType) {
    case 'text':
    case 'url':
      return scoped(textCondition(expression, filter, name, property.valueType));
    case 'number':
      return scoped(orderedCondition(expression, filter, name, '数字', () => requireValue(filter, isNumber, '数字')));
    case 'date':
      return scoped(orderedCondition(expression, filter, name, '日期', () => {
        const value = requireValue(filter, isString, 'YYYY-MM-DD 日期');
        if (Number.isNaN(localDayStart(value))) queryError(`“${value}”不是 YYYY-MM-DD 日期`);
        return value;
      }));
    case 'datetime':
      // 带不同时区的时刻按绝对时间比较，不按字符串。
      return scoped(orderedCondition(expression, filter, name, '日期时间', () => {
        const value = requireValue(filter, isString, '带时区的时刻');
        if (!Number.isFinite(Date.parse(value))) queryError(`“${value}”不是有效时刻`);
        return value;
      }, sql => `unixepoch(${sql}, 'subsec')`));
    case 'checkbox': {
      if (filter.op !== 'eq' && filter.op !== 'neq') unsupported(name, filter.op, '勾选');
      const checked = requireValue(filter, isBoolean, 'true 或 false') === (filter.op === 'eq');
      // 未设置按“未勾选”算：筛未勾选同时命中 false 与没有值。
      return scoped([checked ? `${expression} = 1` : `(${expression} IS NULL OR ${expression} = 0)`, []]);
    }
    case 'select': {
      if (filter.op === 'empty') return scoped([`${expression} IS NULL`, []]);
      if (filter.op === 'not_empty') return scoped([`${expression} IS NOT NULL`, []]);
      if (filter.op !== 'eq' && filter.op !== 'neq') unsupported(name, filter.op, '单选');
      const ids = optionIds(property, filter.value);
      const marks = ids.map(() => '?').join(', ');
      return scoped([filter.op === 'eq'
        ? `${expression} IN (${marks})`
        : `(${expression} IS NULL OR ${expression} NOT IN (${marks}))`, ids]);
    }
    case 'multi_select': {
      if (filter.op === 'empty') return scoped([`${expression} IS NULL`, []]);
      if (filter.op === 'not_empty') return scoped([`${expression} IS NOT NULL`, []]);
      if (filter.op !== 'contains' && filter.op !== 'not_contains') unsupported(name, filter.op, '多选');
      const ids = optionIds(property, filter.value);
      const marks = ids.map(() => '?').join(', ');
      // “包含”命中任一所选选项；“不包含”要求一个都没有（未设置也算不包含）。
      const exists = `EXISTS (SELECT 1 FROM json_each(value.property_values, '$."${safeId(property)}"') chosen WHERE chosen.value IN (${marks}))`;
      return scoped([`${filter.op === 'contains' ? '' : 'NOT '}${exists}`, ids]);
    }
  }
}

function builtinCondition(name: SemanticQueryBuiltinField, filter: SemanticQueryFilter): [string, unknown[]] {
  const column = BUILTIN_COLUMNS[name];
  if (name === 'name') return textCondition(column, filter, '名称', '文字');
  if (name === 'type') {
    if (filter.op !== 'eq' && filter.op !== 'neq') unsupported('type', filter.op, '类型');
    return [`${column} ${filter.op === 'eq' ? '=' : '<>'} ?`, [requireValue(filter, isString, '文档类型')]];
  }
  return orderedCondition(column, filter, name, '时间', () => {
    if (isNumber(filter.value)) return filter.value;
    const value = requireValue(filter, isString, 'YYYY-MM-DD 日期或毫秒时间戳');
    const start = localDayStart(value);
    if (Number.isNaN(start)) queryError(`“${value}”不是 YYYY-MM-DD 日期`);
    return start;
  });
}

/**
 * 把查询描述编译成只读 SQL 片段。纯函数：字段、选项都按传入的定义解析，名称写错时报错并列出可用字段。
 * 范围固定为一个项目里未删除的非文件夹节点，节点按项目索引读取；标签条件走主键，不扫描标签表。
 */
export function compileSemanticQuery(query: SemanticQuery, definitions: SemanticQueryDefinitions): CompiledSemanticQuery {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > SEMANTIC_QUERY_MAX_LIMIT) {
    queryError(`limit 须为 1–${SEMANTIC_QUERY_MAX_LIMIT} 的整数`);
  }
  const available = [...definitions.properties.map(property => property.name), ...SEMANTIC_QUERY_BUILTIN_FIELDS];
  const resolveField = (raw: string): Field => {
    const builtin = SEMANTIC_QUERY_BUILTIN_FIELDS.find(name => name === raw);
    if (builtin) return { kind: 'builtin', name: builtin };
    let key: string | null = null;
    try { key = semanticNameKey(raw); } catch { key = null; }
    const property = definitions.properties.find(candidate => candidate.id === raw) ??
      definitions.properties.find(candidate => semanticNameKey(candidate.name) === key);
    if (!property) throw new SemanticLayerError('unknown_property', `没有字段“${raw}”`, { available });
    return { kind: 'property', property };
  };

  const conditions = [`node.project_id = ?`, 'node.deleted_at IS NULL', "node.type <> 'folder'"];
  const params: unknown[] = [query.projectId];
  for (const raw of query.tags ?? []) {
    let key: string | null = null;
    try { key = semanticNameKey(raw); } catch { key = null; }
    const tag = definitions.tags.find(candidate => candidate.id === raw) ??
      definitions.tags.find(candidate => semanticNameKey(candidate.name) === key);
    if (!tag) {
      throw new SemanticLayerError('unknown_tag', `没有标签“${raw}”`, { available: definitions.tags.map(item => item.name) });
    }
    conditions.push(`EXISTS (SELECT 1 FROM semantic_object_tags tagged
      WHERE tagged.object_kind = 'document' AND tagged.object_id = node.id AND tagged.tag_id = ?)`);
    params.push(tag.id);
  }
  for (const filter of query.where ?? []) {
    const field = resolveField(filter.field);
    const [sql, values] = field.kind === 'builtin'
      ? builtinCondition(field.name, filter)
      : propertyCondition(field.property, filter);
    conditions.push(sql);
    params.push(...values);
  }

  const orderParts: string[] = [];
  const orderParams: unknown[] = [];
  for (const sort of query.sort?.length ? query.sort : [{ field: 'updated', direction: 'desc' as const }]) {
    const field = resolveField(sort.field);
    const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';
    if (field.kind === 'builtin') {
      orderParts.push(`${field.name === 'name' ? 'semantic_fold(node.name)' : BUILTIN_COLUMNS[field.name]} ${direction}`);
      continue;
    }
    const property = field.property;
    if (property.valueType === 'multi_select') queryError(`多选字段“${property.name}”不能排序`);
    let expression = `CASE WHEN ${availableFor(property)} THEN ${valueOf(property)} END`;
    const expressionParams: unknown[] = [];
    if (property.valueType === 'datetime') expression = `unixepoch(${expression}, 'subsec')`;
    if (property.valueType === 'text' || property.valueType === 'url') expression = `semantic_fold(${expression})`;
    if (property.valueType === 'select') {
      // 单选按选项顺序排，不按选项 ID。
      expression = `CASE ${expression} ${property.options.map(() => 'WHEN ? THEN ?').join(' ')} END`;
      for (const [index, option] of property.options.entries()) expressionParams.push(option.id, index);
    }
    // 没有值的排在最后，与方向无关。
    orderParts.push(`(${expression}) IS NULL`, `${expression} ${direction}`);
    orderParams.push(...expressionParams, ...expressionParams);
  }
  orderParts.push('node.id');

  let group: CompiledSemanticQuery['group'];
  if (query.groupBy !== undefined) {
    const field = resolveField(query.groupBy);
    if (field.kind === 'builtin') {
      if (field.name !== 'type') queryError('内建字段只能按 type 分组');
      group = { select: 'node.type', params: [], kind: 'type' };
    } else {
      const property = field.property;
      const raw = `CASE WHEN ${availableFor(property)} THEN ${valueOf(property)} END`;
      if (property.valueType === 'select') group = { select: raw, params: [], kind: 'value' };
      else if (property.valueType === 'checkbox') {
        group = { select: `CASE WHEN ${availableFor(property)} THEN COALESCE(${valueOf(property)}, 0) END`, params: [], kind: 'checkbox' };
      } else if (property.valueType === 'multi_select') {
        group = { select: raw, params: [], kind: 'multi' };
      } else {
        queryError(`只能按单选、多选、勾选字段或 type 分组，“${property.name}”是 ${property.valueType}`);
      }
    }
  }

  return {
    from: `FROM workspace_nodes node
      LEFT JOIN semantic_object_values value ON value.object_kind = 'document' AND value.object_id = node.id
      WHERE ${conditions.join('\n        AND ')}`,
    params,
    orderBy: orderParts.join(', '),
    orderParams,
    ...(group ? { group } : {}),
    limit: query.limit,
  };
}
