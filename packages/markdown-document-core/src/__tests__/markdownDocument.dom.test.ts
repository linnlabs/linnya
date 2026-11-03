// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMarkdownDocumentFragment, parseMarkdownDocument } from '../index';

describe('portable Markdown DOM projection', () => {
  it('正文使用调用方 Document 生成同源结构，不创建交互编辑器', () => {
    const content = parseMarkdownDocument('# 标题\n\n**重点**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    const host = document.createElement('article');
    host.append(createMarkdownDocumentFragment(content, document));
    expect(host.querySelector('h1')?.textContent).toBe('标题');
    expect(host.querySelector('strong')?.textContent).toBe('重点');
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  it('HTML 原文不会作为可执行 DOM 被投影', () => {
    const host = document.createElement('article');
    host.append(createMarkdownDocumentFragment(parseMarkdownDocument('<script>alert(1)</script>'), document));
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });
});

it('交互编辑和只读 DOM 都渲染公式墨迹并保持同样的正式文档', async () => {
  const { Editor } = await import('@tiptap/core');
  const { createMarkdownDocumentExtensions, serializeMarkdownDocument } = await import('../index');
  const content = parseMarkdownDocument('++强调++ ~下标~ ^上标^ [textStyle color="#C00"]红字[/textStyle] $x^2$\n\n$$\n\\frac{a}{b}\n$$');
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: createMarkdownDocumentExtensions(), content });
  try {
    const alternateDocument = document.implementation.createHTMLDocument('readonly');
    const host = alternateDocument.createElement('article'); host.append(createMarkdownDocumentFragment(content, alternateDocument));
    expect(host.querySelectorAll('.katex')).toHaveLength(2); expect(element.querySelectorAll('.katex')).toHaveLength(2);
    expect(host.querySelectorAll('.katex-display')).toHaveLength(1); expect(element.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(host.querySelector('.katex .mord')).not.toBeNull(); expect(host.querySelector('u')?.textContent).toBe('强调'); expect(host.querySelector('sub')?.textContent).toBe('下标'); expect(host.querySelector('sup')?.textContent).toBe('上标');
    expect(host.querySelector('span[style]')?.getAttribute('style')).toContain('color:'); expect(parseMarkdownDocument(serializeMarkdownDocument(editor.getJSON()))).toEqual(content);
  } finally { editor.destroy(); element.remove(); }
});

it('无效 TeX 保留源文，公式命令不获得 HTML 或链接信任', () => {
  const content = parseMarkdownDocument('$\\notARealCommand{x}$ $\\href{javascript:alert(1)}{click}$');
  const host = document.createElement('article'); host.append(createMarkdownDocumentFragment(content, document));
  expect(host.textContent).toContain('notARealCommand');
  expect(host.querySelector('a')).toBeNull(); expect(host.querySelector('script')).toBeNull();
});
