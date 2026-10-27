import type { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/vue-3';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { CodeBlock } from '../../../blocks/CodeBlock';
import { getLowlight } from '../../../core/lowlight';

/** 复用正式 CodeBlock 的 NodeView、高亮和复制；文件不是 Workspace 块，不分配块身份或修订 mark。 */
const FileCodeBlock = CodeBlock.extend({
  marks: '',
  addAttributes: () => ({ language: { default: 'plaintext' } }),
  addKeyboardShortcuts() {
    const newline = () => this.editor.commands.command(({ tr }) => {
      tr.insertText('\n');
      return true;
    });
    // 独立文件始终保持一个 CodeBlock；Shift+Enter 不能触发工作区的拆块/退出流程。
    return { ...this.parent?.(), Enter: newline, 'Shift-Enter': newline };
  },
});

export function textFileContent(text: string, language = 'plaintext'): JSONContent {
  return { type: 'doc', content: [{ type: 'codeBlock', attrs: { language }, content: text ? [{ type: 'text', text }] : [] }] };
}

export function createTextFileEditor(options: {
  content: string;
  label: string;
  readonly: boolean;
  language?: string;
  onChange: (content: string) => void;
}): Editor {
  return new Editor({
    extensions: [Document.extend({ content: 'codeBlock' }), FileCodeBlock.configure({ lowlight: getLowlight(), allowLanguageSelection: false }), Text, UndoRedo],
    content: textFileContent(options.content, options.language),
    editable: !options.readonly,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: { class: 'text-file-editor-control', role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label, spellcheck: 'false' },
      // 从网页或其他编辑器粘贴时也只接纳原文，避免 HTML 改写缩进或 YAML。
      handlePaste(view, event) {
        if (!event.clipboardData) return false;
        view.dispatch(view.state.tr.insertText(event.clipboardData.getData('text/plain')).scrollIntoView());
        return true;
      },
      clipboardTextSerializer: slice => slice.content.textBetween(0, slice.content.size),
    },
    onUpdate: ({ editor }) => options.onChange(editor.state.doc.textContent),
  });
}
