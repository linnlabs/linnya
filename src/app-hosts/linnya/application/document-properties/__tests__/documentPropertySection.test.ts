import { describe, expect, it } from 'vitest';
import type { SemanticObjectState, SemanticPropertyDefinition } from 'src/domains/semantic-layer';
import {
  admitDocumentPropertySection,
  DocumentPropertySectionError,
  formatDocumentPropertySection,
} from '../functions/documentPropertySection';

const property = (id: string, name: string, valueType: SemanticPropertyDefinition['valueType'], options: string[] = []): SemanticPropertyDefinition => ({
  id, name, valueType, options: options.map((option, index) => ({ id: `${id}-${index}`, name: option })), ownerPluginId: null, createdAt: 1,
});

const fields = [
  property('author', '作者', 'text'),
  property('status', '状态', 'select', ['待读', '读完']),
  property('topics', '主题', 'multi_select', ['AI', '数据']),
  property('read', '已读', 'checkbox'),
  property('year', '年份', 'number'),
];

function state(values: SemanticObjectState['values'], tags = ['论文']): SemanticObjectState {
  return {
    ref: { kind: 'document', id: 'd' },
    revision: 3,
    tags: tags.map(name => ({ id: name, name, fields: [], createdAt: 1 })),
    fields: tags.length ? fields.map(item => ({ property: item, tagIds: ['论文'] })) : [],
    values,
  };
}

const LOCATOR = 'workspace:/a.md';

describe('属性段', () => {
  it('已填的一行一个，选项显示名称，勾选 false 是值；没填的合成一行；带被引用数', () => {
    expect(formatDocumentPropertySection({
      state: state({ author: 'Ada', status: 'status-1', topics: ['topics-0', 'topics-1'], read: false }),
      backlinkCount: 2,
    })).toBe([
      '[属性 · 只读，不属于正文；改用 Shell：linnya props]',
      '标签：论文',
      '作者：Ada',
      '状态：读完',
      '主题：AI、数据',
      '已读：否',
      '未填：年份',
      '被 2 份文档引用（linnya links 查看）',
      '[/属性]',
    ].join('\n'));
  });

  it('没有标签也没被引用时不出属性段；只被引用时只给引用数', () => {
    expect(formatDocumentPropertySection({ state: state({}, []), backlinkCount: 0 })).toBeNull();
    expect(formatDocumentPropertySection({ state: state({}, []), backlinkCount: 1 })?.split('\n')).toHaveLength(3);
  });

  it('原样带回的属性段被去掉，行尾空白与 CRLF 不算改动', () => {
    const current = formatDocumentPropertySection({ state: state({ author: 'Ada' }), backlinkCount: 0 }) ?? '';
    expect(admitDocumentPropertySection(`${current}\n\n# 正文`, current, LOCATOR)).toBe('# 正文');
    expect(admitDocumentPropertySection(`\n${current.split('\n').join('  \r\n')}\r\n# 正文`, current, LOCATOR)).toBe('# 正文');
    expect(admitDocumentPropertySection('# 正文', current, LOCATOR)).toBe('# 正文');
  });

  it('改过、过期、写在中间或文档没有属性段时拒绝，报错给出 CLI 命令', () => {
    const current = formatDocumentPropertySection({ state: state({ author: 'Ada' }), backlinkCount: 0 }) ?? '';
    const reject = (text: string, section: string | null) => expect(() => admitDocumentPropertySection(text, section, LOCATOR)).toThrow(DocumentPropertySectionError);
    reject(`${current.replace('Ada', 'Bob')}\n\n正文`, current);
    reject(`正文\n\n${current}`, current);
    reject(`${current}\n\n正文`, null);
    expect(() => admitDocumentPropertySection(`${current.replace('Ada', 'Bob')}`, current, LOCATOR))
      .toThrow('linnya props set workspace:/a.md 字段=值 --rev 版本');
  });
});
