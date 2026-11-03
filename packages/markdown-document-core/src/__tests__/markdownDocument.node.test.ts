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
