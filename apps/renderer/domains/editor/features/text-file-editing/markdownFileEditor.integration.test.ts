// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/vue-3';
import { createMarkdownFileEditor } from './functions/createMarkdownFileEditor';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

describe('独立 Markdown 文件编辑', () => {
  it('渲染并编辑标题、列表、表格、任务、图片和正式 CodeBlock，保存保留语义与元数据', () => {
    const prefix = '\uFEFF---\r\nname: report\r\ndescription: |\r\n  多行描述\r\n---\r\n';
    const body = '# 周报\n\n**成果** 与 [来源](https://example.com)\n\n- 事项\n\n- [x] 完成\n\n| 项目 | 状态 |\n| --- | --- |\n| 研发 | 完成 |\n\n![流程](https://example.com/image.png)\n\n```typescript\nconst title = "周报";\n```\n';
    const content = prefix + body.replace(/\n/g, '\r\n');
    const onChange = vi.fn();
    const session = createMarkdownFileEditor({ content, label: 'SKILL.md', readonly: false, onChange });
    editor = session.editor;
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('周报');
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('成果');
    expect(editor.view.dom.querySelector('table')?.textContent).toContain('研发');
    expect(editor.view.dom.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('https://example.com/image.png');
    expect(editor.view.dom.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(editor.state.doc.textContent).not.toContain('name: report');
    expect(session.readContent()).toBe(content);
    expect(onChange).not.toHaveBeenCalled();
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: '新增' }] });
    const saved = session.readContent();
    expect(saved.startsWith(prefix)).toBe(true);
    expect(saved).toMatch(/\| 研发\s+\| 完成\s+\|/);
    expect(saved).toContain('- [x] 完成');
    expect(saved).toContain('![流程](https://example.com/image.png)');
    expect(saved).toContain('```typescript\r\nconst title = "周报";\r\n```');
    expect(saved).toContain('新增');
    // v-model 回传不重建文档；撤销可以回到原文件的精确字节。
    session.replaceContent(saved);
    editor.commands.undo();
    expect(session.readContent()).toBe(content);
    expect(onChange).toHaveBeenLastCalledWith(content);
  });

  it('编辑相邻段落时保留原生 HTML 与注释，显示时过滤脚本', () => {
    const html = '<div>说明<script>unsafe()</script></div>';
    const comment = '<!-- 保留这个隐藏说明 -->';
    const session = createMarkdownFileEditor({ content: `${comment}\n\n${html}\n\n正文`, label: 'notes.md', readonly: false, onChange: () => {} });
    editor = session.editor;
    expect(editor.view.dom.querySelector('script')).toBeNull();
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: '新增' }] });
    expect(session.readContent()).toContain(comment);
    expect(session.readContent()).toContain(html);
  });

  it('只读文件不可输入；外部刷新替换内容不触发编辑事件', () => {
    const onChange = vi.fn();
    const session = createMarkdownFileEditor({ content: '# 只读', label: 'SKILL.md', readonly: true, onChange });
    editor = session.editor;
    expect(editor.view.dom.getAttribute('contenteditable')).toBe('false');
    session.replaceContent('# 外部更新\n');
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('外部更新');
    expect(session.readContent()).toBe('# 外部更新\n');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('代码围栏内 Enter 换行和 Tab 缩进，退出围栏后继续编辑正文', () => {
    const session = createMarkdownFileEditor({ content: '```typescript\nconst a = 1;\n```', label: 'notes.md', readonly: false, onChange: () => {} });
    editor = session.editor;
    editor.commands.setTextSelection(1);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.state.doc.firstChild?.textContent).toBe('  \nconst a = 1;');
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.commands.exitCode()).toBe(true);
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
  });
});
