import {
  SEMANTIC_QUERY_BUILTIN_FIELDS,
  SemanticLayerError,
  semanticNameKey,
  type SemanticPropertyDefinition,
  type SemanticQueryFilter,
} from 'src/domains/semantic-layer';
import type { RawQueryFilter } from './parseSemanticCommands';

const TRUE = new Set(['true', 'yes', 'y', '1', '是', '对', '勾选']);
const FALSE = new Set(['false', 'no', 'n', '0', '否', '不', '未勾选']);

function splitNames(raw: string): string[] {
  return raw.split(/[,，]/u).map(value => value.trim()).filter(Boolean);
}

/**
 * 命令行只有文字；按字段类型转成语义层接受的值。空字符串表示清除（与空值合同一致），
 * 选项名、日期格式等仍由语义层校验，这里不重复规则。
 */
export function coerceCliValue(property: SemanticPropertyDefinition, raw: string): unknown {
  if (property.valueType === 'text') return raw === '' ? null : raw;
  const value = raw.trim();
  if (value === '') return null;
  switch (property.valueType) {
    case 'number': {
      if (!/^-?\d+(\.\d+)?$/u.test(value)) {
        throw new SemanticLayerError('invalid_value', `字段“${property.name}”需要数字：${raw}`, { propertyId: property.id });
      }
      return Number(value);
    }
    case 'checkbox': {
      const key = value.toLowerCase();
      if (TRUE.has(key)) return true;
      if (FALSE.has(key)) return false;
      throw new SemanticLayerError('invalid_value', `字段“${property.name}”需要 true 或 false：${raw}`, { propertyId: property.id });
    }
    case 'multi_select':
      return splitNames(value);
    default:
      return value;
  }
}

export function findProperty(properties: readonly SemanticPropertyDefinition[], raw: string): SemanticPropertyDefinition | undefined {
  let key: string | null;
  try { key = semanticNameKey(raw); } catch { key = null; }
  return properties.find(property => property.id === raw) ?? properties.find(property => semanticNameKey(property.name) === key);
}

/** 字段未知时原样交给编译器，由它报错并列出可用字段。 */
export function coerceQueryFilter(filter: RawQueryFilter, properties: readonly SemanticPropertyDefinition[]): SemanticQueryFilter {
  if (filter.raw === null) return { field: filter.field, op: filter.op };
  const property = SEMANTIC_QUERY_BUILTIN_FIELDS.some(name => name === filter.field) ? undefined : findProperty(properties, filter.field);
  if (!property) return { field: filter.field, op: filter.op, value: filter.raw };
  if (property.valueType === 'multi_select') {
    const options = splitNames(filter.raw);
    return { field: filter.field, op: filter.op, value: options.length === 1 ? options[0] : options };
  }
  const value = coerceCliValue(property, filter.raw);
  return { field: filter.field, op: filter.op, value: value as Exclude<SemanticQueryFilter['value'], undefined> };
}

/** 给模型读的值：选项显示名称，勾选显示是/否。 */
export function displayValue(property: SemanticPropertyDefinition, value: unknown): string {
  if (value === undefined || value === null) return '（空）';
  const option = (id: unknown) => property.options.find(candidate => candidate.id === id)?.name ?? String(id);
  if (property.valueType === 'checkbox') return value === true ? '是' : '否';
  if (property.valueType === 'select') return option(value);
  if (Array.isArray(value)) return value.map(option).join('、');
  return String(value);
}

/** JSON 输出用：选项换成名称，其他原样。 */
export function jsonValue(property: SemanticPropertyDefinition, value: unknown): unknown {
  const option = (id: unknown) => property.options.find(candidate => candidate.id === id)?.name ?? id;
  if (property.valueType === 'select') return option(value);
  if (Array.isArray(value)) return value.map(option);
  return value;
}
