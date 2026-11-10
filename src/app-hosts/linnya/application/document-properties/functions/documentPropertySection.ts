import type { SemanticObjectState } from 'src/domains/semantic-layer';

/** 首行以它开头、末行等于结束标记；不编行号，和 `[read_file: …]` 提示同一层。 */
export const PROPERTY_SECTION_START = '[属性 · 只读';
export const PROPERTY_SECTION_END = '[/属性]';

export class DocumentPropertySectionError extends Error {
  constructor(locator: string) {
    super(
      `[DOCUMENT_PROPERTIES_READONLY] 属性段（${PROPERTY_SECTION_START} … ${PROPERTY_SECTION_END}）只读，不属于正文，也不能用文件工具修改。`
      + `写正文时去掉这一段；改标签或字段用 Shell：linnya props get ${locator} 查看版本，`
      + `再 linnya props set ${locator} 字段=值 --rev 版本（linnya props --help 查看全部用法）。`,
    );
    this.name = 'DocumentPropertySectionError';
  }
}

function displayValue(field: SemanticObjectState['fields'][number], value: unknown): string {
  const { property } = field;
  const option = (id: unknown) => property.options.find(candidate => candidate.id === id)?.name ?? String(id);
  if (property.valueType === 'checkbox') return value === true ? '是' : '否';
  if (property.valueType === 'select') return option(value);
  if (Array.isArray(value)) return value.map(option).join('、');
  return String(value);
}

/**
 * 没有标签、也没有被引用的文档不出属性段：不给每次读取加噪声，也不改变没有用到标签的对照基准。
 * 已填的值一行一个；没填的字段合成一行，让 Agent 知道可以填什么。
 */
export function formatDocumentPropertySection(input: {
  readonly state: SemanticObjectState;
  readonly backlinkCount: number;
}): string | null {
  const { state, backlinkCount } = input;
  if (!state.tags.length && backlinkCount === 0) return null;
  const lines = [`${PROPERTY_SECTION_START}，不属于正文；改用 Shell：linnya props]`];
  if (state.tags.length) {
    lines.push(`标签：${state.tags.map(tag => tag.name).join('、')}`);
    const empty: string[] = [];
    for (const field of state.fields) {
      const value = state.values[field.property.id];
      if (value === undefined) empty.push(field.property.name);
      else lines.push(`${field.property.name}：${displayValue(field, value)}`);
    }
    if (empty.length) lines.push(`未填：${empty.join('、')}`);
  }
  if (backlinkCount > 0) lines.push(`被 ${backlinkCount} 份文档引用（linnya links 查看）`);
  lines.push(PROPERTY_SECTION_END);
  return lines.join('\n');
}

const isStart = (line: string) => line.trimStart().startsWith(PROPERTY_SECTION_START);
const isEnd = (line: string) => line.trim() === PROPERTY_SECTION_END;

/**
 * 写入前处理属性段：Agent 把读到的属性段原样带回时去掉它（连同其后的一个空行）；
 * 剩下的文字里仍有属性段标记（改过、过期或写在中间）就拒绝，报错给出 CLI 用法。
 */
export function admitDocumentPropertySection(text: string, current: string | null, locator: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trim() !== '');
  if (current !== null && start >= 0 && isStart(lines[start] ?? '')) {
    const end = lines.findIndex((line, index) => index > start && isEnd(line));
    const expected = current.split('\n').map(line => line.trim());
    const block = end > start ? lines.slice(start, end + 1).map(line => line.replace(/\r$/u, '').trim()) : [];
    if (block.length === expected.length && block.every((line, index) => line === expected[index])) {
      const rest = lines.slice(end + 1);
      if (rest[0]?.trim() === '') rest.shift();
      text = rest.join('\n');
    }
  }
  if (text.split('\n').some(line => isStart(line) || isEnd(line))) throw new DocumentPropertySectionError(locator);
  return text;
}
