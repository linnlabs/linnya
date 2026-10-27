// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/vue-3';
import { createTextFileEditor } from './functions/createTextFileEditor';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

describe('独立文本文件编辑', () => {
  it.each([
    '',
    '---\nname: report\ndescription: |\n  多行描述\n---\n\n# 标题\n\n```sh\necho "$HOME"\n```\n',
    '\uFEFF---\r\nname: report\r\n---\r\n\t缩进  \r\n\r\n',
    '<script>literal()</script>\nconst value = "<p>";\n',
  ])('打开与编辑原文，保留空白、YAML、HTML 字面量和换行：%j', content => {
    const onChange = vi.fn();
    editor = createTextFileEditor({ content, label: 'SKILL.md', readonly: false, onChange });
    expect(editor.state.doc.textContent).toBe(content);
    expect(onChange).not.toHaveBeenCalled();
    editor.commands.insertContentAt(1 + content.length, { type: 'text', text: '新增' });
    expect(onChange).toHaveBeenLastCalledWith(content + '新增');
    editor.commands.undo();
    expect(onChange).toHaveBeenLastCalledWith(content);
    expect(editor.view.dom.querySelector('script')).toBeNull();
  });

  it('键盘换行始终留在同一个原文节点，支持连续空行', () => {
    editor = createTextFileEditor({ content: '---', label: 'SKILL.md', readonly: false, onChange: () => {} });
    editor.commands.setTextSelection(4);
    for (let index = 0; index < 3; index++) {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    expect(editor.state.doc.textContent).toBe('---\n\n\n');
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('复用 CodeBlock 的缩进与高亮，Shift+Enter 不把独立文件拆成文档块', () => {
    editor = createTextFileEditor({ content: 'const title = "周报";', language: 'typescript', label: 'collect.ts', readonly: false, onChange: () => {} });
    expect(editor.view.dom.querySelector('.hljs-keyword')?.textContent).toBe('const');
    editor.commands.setTextSelection(1);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(editor.state.doc.textContent).toBe('  \nconst title = "周报";');
    expect(editor.state.doc.childCount).toBe(1);
  });
});
