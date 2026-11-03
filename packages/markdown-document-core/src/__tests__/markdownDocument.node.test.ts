import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../index';

describe('portable Markdown document conversion', () => {
  it('无 DOM 的 Node 中保留标题、列表、行内格式和代码围栏', () => {
    expect(typeof globalThis.document).toBe('undefined');
    const markdown = '## 标题\n\n正文 **重点** 与 [链接](https://example.com)\n\n- 第一项\n- 第二项\n\n```ts\nconst value = 1\n```';
    const content = parseMarkdownDocument(markdown);
    const rendered = serializeMarkdownDocument(content);
    expect(rendered).toContain('## 标题');
    expect(rendered).toContain('**重点**');
    expect(rendered).toContain('[链接](https://example.com)');
    expect(rendered).toContain('```ts');
    expect(parseMarkdownDocument(rendered)).toEqual(content);
  });

  it('正文转 Markdown 不静默丢掉未知属性或未解析的文档身份', () => {
    expect(() => serializeMarkdownDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { impossible: true } }] })).toThrow('未知属性');
    expect(() => serializeMarkdownDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: 'doc', referenceId: 'ref' } }] }] })).toThrow('document_reference_projection_required');
  });
});

it('无 DOM 地保留全部正式行内样式、颜色和两种数学节点', () => {
  expect(typeof globalThis.document).toBe('undefined');
  const content = parseMarkdownDocument('++下划线++ ~下标~ ^上标^ ==高亮== [textStyle color="#C00"]**红字**[/textStyle] [highlight color="yellow"]有色高亮[/highlight] $E=mc^2$\n\n$$\n\\frac{a}{b}\n$$');
  const rendered = serializeMarkdownDocument(content);
  expect(rendered).toContain('++下划线++'); expect(rendered).toContain('~下标~'); expect(rendered).toContain('^上标^');
  expect(rendered).toContain('$E=mc^2$'); expect(rendered).toContain('$$\n\\frac{a}{b}\n$$');
  expect(parseMarkdownDocument(rendered)).toEqual(content);
});

it('拒绝错误公式/颜色类型和未开放的字体字号属性', () => {
  const doc = (content: import('@app/schemas').JsonValue) => ({ type: 'doc', content: [{ type: 'paragraph', content: [content] }] });
  expect(() => serializeMarkdownDocument(doc({ type: 'inlineMath', attrs: { latex: { unsafe: true } } }))).toThrow();
  expect(() => serializeMarkdownDocument(doc({ type: 'text', text: '字', marks: [{ type: 'highlight', attrs: { color: { unsafe: true } } }] }))).toThrow();
  expect(() => serializeMarkdownDocument(doc({ type: 'text', text: '字', marks: [{ type: 'textStyle', attrs: { fontSize: '99px' } }] }))).toThrow('未知属性');
});

it('公式中的转义美元符号以及空/换行行内公式可逆', () => {
  const content = parseMarkdownDocument('$\\text{\\$5}$\n\n$$\n\\text{\\$5}\n$$');
  expect(parseMarkdownDocument(serializeMarkdownDocument(content))).toEqual(content);
  const special: import('@app/schemas').JsonValue = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '' } }, { type: 'inlineMath', attrs: { latex: 'a\nb' } }] }] };
  expect(parseMarkdownDocument(serializeMarkdownDocument(special))).toEqual(special);
});
