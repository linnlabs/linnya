import { normalizeSemanticValue } from '../../../functions/normalizeSemanticValue';
import {
  SemanticLayerError,
  type SemanticPropertyDefinition,
  type SemanticSelectOption,
  type SemanticValue,
  type SemanticValueType,
} from '../../../definitions/semanticLayer';

/** 改成单选、多选时，从已有文字生成的选项最多这么多；更多说明这个字段不是在分类。 */
export const MAX_GENERATED_OPTIONS = 50;

const LIST_SEPARATOR = /[,，、;；]/;
const TRUE_WORDS = new Set(['是', 'true', 'yes', 'y', '1', '✓', '√']);
const FALSE_WORDS = new Set(['否', 'false', 'no', 'n', '0', '✗', '×']);
const DATE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ConversionOutcome =
  | { readonly kind: 'converted'; readonly value: SemanticValue }
  | { readonly kind: 'failed' }
  | { readonly kind: 'emptied' };

const optionKey = (name: string) => name.normalize('NFKC').trim().toLowerCase();

/** 值的文字形式：改类型统一先转成文字再按目标类型解析，也用作预览样例。 */
export function semanticValueText(property: SemanticPropertyDefinition, value: SemanticValue): string {
  const optionName = (id: string) => property.options.find(option => option.id === id)?.name ?? '';
  switch (property.valueType) {
    case 'checkbox':
      return value === true ? '是' : '否';
    case 'number':
      return String(value);
    case 'select':
      return typeof value === 'string' ? optionName(value) : '';
    case 'multi_select':
      return Array.isArray(value) ? value.map(optionName).filter(Boolean).join('、') : '';
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

function calendarDate(text: string): string | null {
  const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(text);
  const match = DATE.exec(iso ? iso[1] : text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
}

/** 只有日期时补当地零点，带上那一天的时区偏移，不存没有时区的钟面时间。 */
function localMidnight(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const offsetMinutes = -new Date(year, month - 1, day).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${date}T00:00:00${sign}${pad(String(Math.floor(absolute / 60)))}:${pad(String(absolute % 60))}`;
}

function listItems(text: string): string[] {
  return text.split(LIST_SEPARATOR).map(item => item.trim()).filter(Boolean);
}

/**
 * 改成单选、多选时的选项：原来就是单选、多选的沿用原选项与 ID；否则按已有文字出现的先后生成，
 * 多选按逗号、顿号、分号拆开。超过上限报错，不生成一长串选项。
 */
export function optionsForConversion(
  from: SemanticPropertyDefinition,
  toType: SemanticValueType,
  texts: readonly string[],
  newId: () => string
): SemanticSelectOption[] {
  if (toType !== 'select' && toType !== 'multi_select') return [];
  if (from.valueType === 'select' || from.valueType === 'multi_select') return [...from.options];
  const names = new Map<string, string>();
  for (const text of texts) {
    const items = toType === 'multi_select' ? listItems(text) : [text.trim()].filter(Boolean);
    for (const item of items) if (!names.has(optionKey(item))) names.set(optionKey(item), item);
  }
  if (names.size > MAX_GENERATED_OPTIONS) {
    throw new SemanticLayerError(
      'invalid_definition',
      `“${from.name}”有 ${names.size} 种不同的值，超过 ${MAX_GENERATED_OPTIONS} 个，不适合改成${toType === 'select' ? '单选' : '多选'}`,
      { distinctValues: names.size, limit: MAX_GENERATED_OPTIONS }
    );
  }
  return [...names.values()].map(name => ({ id: newId(), name }));
}

/** 把一个值转成目标类型。单选与多选之间按选项 ID 直接转，其余先转成文字再解析。 */
export function convertSemanticValue(
  from: SemanticPropertyDefinition,
  value: SemanticValue,
  toType: SemanticValueType,
  toOptions: readonly SemanticSelectOption[]
): ConversionOutcome {
  if (from.valueType === 'select' && toType === 'multi_select' && typeof value === 'string') {
    return { kind: 'converted', value: [value] };
  }
  if (from.valueType === 'multi_select' && toType === 'select' && Array.isArray(value)) {
    return value.length === 1 && typeof value[0] === 'string' ? { kind: 'converted', value: value[0] } : { kind: 'failed' };
  }
  const raw = semanticValueText(from, value);
  const text = raw.trim();
  if (text === '') return { kind: 'emptied' };
  const option = (name: string) => toOptions.find(candidate => optionKey(candidate.name) === optionKey(name))?.id;
  switch (toType) {
    case 'text':
      return { kind: 'converted', value: raw };
    case 'number': {
      const cleaned = text.replace(/[,，\s]/g, '');
      const number = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(cleaned) ? Number(cleaned) : Number.NaN;
      return Number.isFinite(number) ? { kind: 'converted', value: number } : { kind: 'failed' };
    }
    case 'checkbox': {
      const word = text.toLowerCase();
      if (TRUE_WORDS.has(word)) return { kind: 'converted', value: true };
      if (FALSE_WORDS.has(word)) return { kind: 'converted', value: false };
      return { kind: 'failed' };
    }
    case 'date': {
      const date = calendarDate(text);
      return date ? { kind: 'converted', value: date } : { kind: 'failed' };
    }
    case 'datetime': {
      if (DATETIME.test(text) && Number.isFinite(Date.parse(text))) return { kind: 'converted', value: text };
      const date = calendarDate(text);
      return date ? { kind: 'converted', value: localMidnight(date) } : { kind: 'failed' };
    }
    case 'url':
      return URL.canParse(text) ? { kind: 'converted', value: text } : { kind: 'failed' };
    case 'select': {
      const id = option(text);
      return id ? { kind: 'converted', value: id } : { kind: 'failed' };
    }
    case 'multi_select': {
      const ids = listItems(text).map(option);
      if (ids.some(id => id === undefined)) return { kind: 'failed' };
      const unique = [...new Set(ids.filter((id): id is string => id !== undefined))];
      return unique.length ? { kind: 'converted', value: unique } : { kind: 'emptied' };
    }
  }
}

/** 单选、多选的值只保留仍在选项里的 ID；单选的选项不在了即清除，多选去掉不在的那几项。 */
export function keepExistingOptions(
  property: SemanticPropertyDefinition,
  value: SemanticValue,
): SemanticValue | undefined {
  const ids = new Set(property.options.map(option => option.id));
  if (property.valueType === 'select') return typeof value === 'string' && ids.has(value) ? value : undefined;
  if (property.valueType === 'multi_select') {
    const rest = Array.isArray(value) ? value.filter(id => typeof id === 'string' && ids.has(id)) : [];
    return rest.length ? rest : undefined;
  }
  return value;
}

/**
 * 把来历不明（不知道写入时的字段定义）的旧值整理成当前定义下的值，如按版本恢复时。
 * 当前定义能直接接受的照常规整；否则按值本身的形状当作文字、数字或勾选，用改类型的规则转换；
 * 单选、多选只认仍在选项里的 ID 或选项名。返回 undefined 表示当前定义下放不下，应清除。
 */
export function conformSemanticValue(
  property: SemanticPropertyDefinition,
  value: SemanticValue,
): SemanticValue | undefined {
  try {
    return normalizeSemanticValue(property, value);
  } catch (error) {
    if (!(error instanceof SemanticLayerError) || error.code !== 'invalid_value') throw error;
  }
  if (Array.isArray(value)) return property.valueType === 'multi_select' ? keepExistingOptions(property, value) : undefined;
  const fromType: SemanticValueType = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'checkbox' : 'text';
  const outcome = convertSemanticValue(
    { ...property, valueType: fromType, options: [] }, value, property.valueType, property.options,
  );
  return outcome.kind === 'converted' ? outcome.value : undefined;
}
