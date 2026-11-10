import {
  SemanticLayerError,
  type SemanticPropertyDefinition,
  type SemanticValue,
} from '../definitions/semanticLayer';

const MAX_TEXT_LENGTH = 10_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// 日期时间必须带时区：Z 或 ±hh:mm。只存本地钟面时间会在换时区后变成另一天（Logseq 的教训）。
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function invalid(property: SemanticPropertyDefinition, expected: string, value: unknown): never {
  throw new SemanticLayerError('invalid_value', `字段“${property.name}”需要${expected}`, {
    propertyId: property.id, valueType: property.valueType, received: typeof value,
  });
}

function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function resolveOption(property: SemanticPropertyDefinition, raw: unknown): string {
  if (typeof raw !== 'string') invalid(property, '选项名或选项 ID', raw);
  const option = property.options.find(candidate => candidate.id === raw) ??
    property.options.find(candidate => candidate.name.normalize('NFKC').toLowerCase() === raw.normalize('NFKC').trim().toLowerCase());
  if (!option) {
    throw new SemanticLayerError('invalid_value', `字段“${property.name}”没有选项“${raw}”`, {
      propertyId: property.id, options: property.options.map(candidate => candidate.name),
    });
  }
  return option.id;
}

/**
 * 写入前把值规整成唯一的存储形状。空值合同（读写与筛选共用）：
 * - `null` 表示清除，存储里没有这个键，即“未设置”；
 * - 空字符串与空列表同样存为“未设置”，存储里不会出现 `""` 或 `[]`，筛选“为空”只需判断键不存在；
 * - 勾选的 `false` 是一个值，与“未设置”分开存；筛选“未勾选”同时包含两者。
 * 返回 `undefined` 表示清除。
 */
export function normalizeSemanticValue(
  property: SemanticPropertyDefinition,
  value: unknown
): SemanticValue | undefined {
  if (value === null || value === undefined) return undefined;
  switch (property.valueType) {
    case 'text': {
      if (typeof value !== 'string') invalid(property, '文字', value);
      if (value === '') return undefined;
      if (value.length > MAX_TEXT_LENGTH) invalid(property, `不超过 ${MAX_TEXT_LENGTH} 字的文字`, value);
      return value;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid(property, '有限的数字', value);
      return value;
    case 'checkbox':
      if (typeof value !== 'boolean') invalid(property, 'true 或 false', value);
      return value;
    case 'date':
      if (typeof value !== 'string' || !isCalendarDate(value)) invalid(property, 'YYYY-MM-DD 格式的日历日', value);
      return value;
    case 'datetime':
      if (typeof value !== 'string' || !DATETIME.test(value) || !Number.isFinite(Date.parse(value))) {
        invalid(property, '带时区的时刻，如 2026-11-10T09:30:00+08:00', value);
      }
      return value;
    case 'url': {
      if (typeof value !== 'string') invalid(property, '网址', value);
      if (value === '') return undefined;
      if (!URL.canParse(value)) invalid(property, '带协议的完整网址', value);
      return value;
    }
    case 'select':
      if (value === '') return undefined;
      return resolveOption(property, value);
    case 'multi_select': {
      if (!Array.isArray(value)) invalid(property, '选项列表', value);
      const ids = [...new Set(value.map(item => resolveOption(property, item)))];
      return ids.length ? ids : undefined;
    }
  }
}
