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
