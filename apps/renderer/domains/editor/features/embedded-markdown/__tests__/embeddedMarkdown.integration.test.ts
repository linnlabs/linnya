// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmbeddedMarkdownEditor, parseEmbeddedMarkdown, serializeEmbeddedMarkdown } from '..';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function mount(content: string) {
  const element = document.createElement('div');
  document.body.append(element);
  const onUpdate = vi.fn(), onBlur = vi.fn();
  const handle = createEmbeddedMarkdownEditor({ element, label: '正文', content: parseEmbeddedMarkdown(content), onUpdate, onBlur });
  cleanups.push(() => { handle.destroy(); element.remove(); });
  return { handle, element, onUpdate, onBlur };
}

describe('embedded Markdown surface', () => {
  it('独立表面共用真实 Markdown schema，替换不会互相污染或触发保存', () => {
    const first = mount('## 标题\n\n正文 **重点**');
    const second = mount('另一个文档');
    first.handle.replaceContent(parseEmbeddedMarkdown('替换后的 *正文*'));
    expect(first.handle.readMarkdown()).toContain('*正文*');
    expect(second.handle.readMarkdown()).toContain('另一个文档');
    expect(first.onUpdate).not.toHaveBeenCalled();
    expect(serializeEmbeddedMarkdown(first.handle.readContent())).toBe(first.handle.readMarkdown());
    // 根节点即正文容器，首尾边距等只读呈现规则同样作用于编辑态。
    expect(first.element.querySelector('.ProseMirror')?.classList.contains('markdown-document-content')).toBe(true);
  });

  it('未知节点和非法文档拒绝替换并保留当前正文', () => {
    const { handle } = mount('已保存');
    expect(() => handle.replaceContent({ type: 'doc', content: [{ type: 'unknownNode' }] })).toThrow();
    expect(handle.readMarkdown()).toBe('已保存');
    expect(() => handle.replaceContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { unsupported: true } }] })).toThrow('未知属性');
    expect(() => handle.replaceContent({ type: 'text', text: '不是文档' })).toThrow();
    expect(handle.readMarkdown()).toBe('已保存');
  });

  it('异步插入锚点跨后续输入映射，替换正文后不能误插到下一张卡', () => {
    const { handle } = mount('原文');
    const insertion = handle.captureInsertion();
    expect(insertion.insert({ type: 'image', attrs: { src: 'asset:one', assetId: 'one', alt: '图片' } })).toBe(true);
    expect(handle.readContent()).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: 'image', attrs: expect.objectContaining({ assetId: 'one' }) })]) });
    const stale = handle.captureInsertion();
    handle.replaceContent(parseEmbeddedMarkdown('下一张卡'));
    expect(stale.insert({ type: 'image', attrs: { src: 'asset:two', assetId: 'two' } })).toBe(false);
    expect(handle.readMarkdown()).toBe('下一张卡');
  });

  it('只读与重新编辑使用同一正文，不需要 Workspace 保存会话', () => {
    const { handle, element } = mount('- 第一项\n- 第二项');
    const insertion = handle.captureInsertion();
    handle.setEditable(false);
    expect(element.querySelector('[contenteditable="false"]')).not.toBeNull();
    expect(insertion.insert({ type: 'paragraph' })).toBe(false);
    expect(() => handle.insertContent({ type: 'paragraph' })).toThrow('只读');
    expect(() => handle.captureInsertion()).toThrow('只读');
    handle.setEditable(true);
    expect(element.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(handle.readMarkdown()).toContain('第一项');
  });

  it('焦点移入表面内的标签控件不结束编辑，从该控件移到外部才通知保存', () => {
    const { handle, element, onUpdate, onBlur } = mount('保留当前草稿');
    const editable = element.querySelector('[contenteditable="true"]');
    if (!(editable instanceof HTMLElement)) throw new Error('Editor DOM is missing');
    const internal = document.createElement('button'), external = document.createElement('button');
    element.append(internal); document.body.append(external); cleanups.push(() => external.remove());
    editable.focus(); internal.focus();
    expect(onBlur).not.toHaveBeenCalled(); expect(onUpdate).not.toHaveBeenCalled();
    expect(handle.readMarkdown()).toBe('保留当前草稿');
    external.focus(); expect(onBlur).toHaveBeenCalledOnce();
    internal.focus(); handle.destroy(); external.focus();
    expect(onBlur).toHaveBeenCalledOnce();
  });
});
