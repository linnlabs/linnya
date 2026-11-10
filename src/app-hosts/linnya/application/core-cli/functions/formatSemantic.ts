import type {
  SemanticLayerError,
  SemanticObjectState,
  SemanticPropertyDefinition,
  SemanticTagDefinition,
  SemanticValueType,
} from 'src/domains/semantic-layer';
import { displayValue, jsonValue } from './semanticCliValues';

const TYPE_LABELS: Record<SemanticValueType, string> = {
  text: '文本', number: '数字', date: '日期', datetime: '日期时间', checkbox: '勾选',
  select: '单选', multi_select: '多选', url: '网址',
};

/** 超出 Shell 展示预算时停在整行，并明说结果不完整。 */
export function fitLines(lines: readonly string[], maxCharacters: number, notice: string): string {
  let output = '';
  for (const line of lines) {
    if (output.length + line.length + 1 > maxCharacters - notice.length - 1) return `${output}${notice}\n`;
    output += `${line}\n`;
  }
  return output;
}

export function shellQuote(value: string): string {
  return /^[\p{L}\p{N}_\-./:=,，@+%]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function tagFieldsText(tag: SemanticTagDefinition, properties: readonly SemanticPropertyDefinition[]): string {
  if (!tag.fields.length) return '（无字段）';
  return tag.fields.map(field => {
    const property = properties.find(candidate => candidate.id === field.propertyId);
    const name = property?.name ?? field.propertyId;
    return field.defaultValue === undefined || !property ? name : `${name}=${displayValue(property, field.defaultValue)}`;
  }).join('、');
}

export function formatTagLine(tag: SemanticTagDefinition, properties: readonly SemanticPropertyDefinition[]): string {
  return `${tag.name}：${tagFieldsText(tag, properties)}`;
}

export function formatSchema(tags: readonly SemanticTagDefinition[], properties: readonly SemanticPropertyDefinition[]): string {
  const lines = [`标签（${tags.length}）`];
  for (const tag of tags) lines.push(`- ${formatTagLine(tag, properties)}`);
  lines.push(`字段（${properties.length}）`);
  for (const property of properties) {
    const options = property.options.length ? `：${property.options.map(option => option.name).join(' / ')}` : '';
    lines.push(`- ${property.name}  ${TYPE_LABELS[property.valueType]}${options}${property.ownerPluginId ? '  插件字段，只读' : ''}`);
  }
  if (!tags.length && !properties.length) lines.push('还没有标签和字段。新建前先看这里有没有可复用的。');
  return `${lines.join('\n')}\n`;
}

export function schemaJson(tags: readonly SemanticTagDefinition[], properties: readonly SemanticPropertyDefinition[]) {
  return {
    tags: tags.map(tag => ({
      id: tag.id, name: tag.name,
      fields: tag.fields.map(field => {
        const property = properties.find(candidate => candidate.id === field.propertyId);
        return { name: property?.name ?? field.propertyId, ...(field.defaultValue === undefined || !property ? {} : { default: jsonValue(property, field.defaultValue) }) };
      }),
    })),
    properties: properties.map(property => ({
      id: property.id, name: property.name, type: property.valueType,
      ...(property.options.length ? { options: property.options.map(option => option.name) } : {}),
      ...(property.ownerPluginId ? { readonly: true } : {}),
    })),
  };
}

export function formatObject(path: string, state: SemanticObjectState): string {
  const lines = [`${path}  版本 ${state.revision}`, `标签：${state.tags.map(tag => tag.name).join('、') || '（无）'}`];
  for (const field of state.fields) lines.push(`${field.property.name}：${displayValue(field.property, state.values[field.property.id])}`);
  return `${lines.join('\n')}\n`;
}

export function objectJson(path: string, state: SemanticObjectState) {
  return {
    path, revision: state.revision,
    tags: state.tags.map(tag => tag.name),
    fields: state.fields.map(field => field.property.name),
    values: Object.fromEntries(state.fields.flatMap(field => {
      const value = state.values[field.property.id];
      return value === undefined ? [] : [[field.property.name, jsonValue(field.property, value)]];
    })),
  };
}

/** 标签增减与当前可见字段的值变化；去掉标签后隐藏的旧值不算清除。 */
export function describeChange(before: SemanticObjectState, after: SemanticObjectState): string {
  const beforeTags = new Set(before.tags.map(tag => tag.id));
  const afterTags = new Set(after.tags.map(tag => tag.id));
  const parts = [
    ...after.tags.filter(tag => !beforeTags.has(tag.id)).map(tag => `+${tag.name}`),
    ...before.tags.filter(tag => !afterTags.has(tag.id)).map(tag => `−${tag.name}`),
  ];
  for (const { property } of after.fields) {
    const previous = before.values[property.id];
    const next = after.values[property.id];
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      parts.push(`${property.name}：${displayValue(property, previous)} → ${displayValue(property, next)}`);
    }
  }
  return parts.join('  ') || '无变化';
}

function detailText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item)).join('、');
  }
  return String(value);
}

const HINTS: Partial<Record<SemanticLayerError['code'], string>> = {
  similar_name: '先确认能否复用；确认不是同一个时加 --allow-similar。',
  field_not_available: '先给文档打上带这个字段的标签，或用 linnya schema set-fields 给标签加字段。',
  revision_conflict: '文档的属性刚被改过，先 linnya props get 看当前内容，再按新版本执行。',
  unknown_tag: '用 linnya schema 查看已有标签，或 linnya schema add-tag 新建。',
};

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  available: '可用', candidates: '相近', options: '选项', currentRevision: '当前版本',
};

export function formatSemanticError(error: SemanticLayerError, path?: string): string {
  const lines = [`${error.code} ${path ? `${path}：` : ''}${error.message}`];
  for (const [key, label] of Object.entries(DETAIL_LABELS)) {
    const value = error.details?.[key];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) lines.push(`${label}：${detailText(value)}`);
  }
  const hint = HINTS[error.code];
  if (hint) lines.push(hint);
  return `${lines.join('\n')}\n`;
}
