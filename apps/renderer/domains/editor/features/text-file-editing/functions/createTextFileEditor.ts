import { Node, type JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/vue-3';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';

/** Skill/YAML/脚本必须保留原文，不能经过工作区 Markdown 导入、序列化或保存链。 */
const TextFile = Node.create({
  name: 'textFile',
  content: 'text*',
  marks: '',
  code: true,
  whitespace: 'pre',
  parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' }],
  renderHTML: () => ['pre', { class: 'text-file-editor-content' }, 0],
  addKeyboardShortcuts() {
    const newline = () => this.editor.commands.command(({ tr }) => {
      tr.insertText('\n');
      return true;
    });
    return { Enter: newline, 'Shift-Enter': newline };
  },
});

export function textFileContent(text: string): JSONContent {
  return { type: 'doc', content: [{ type: 'textFile', content: text ? [{ type: 'text', text }] : [] }] };
}

export function createTextFileEditor(options: {
  content: string;
  label: string;
  readonly: boolean;
  onChange: (content: string) => void;
}): Editor {
  return new Editor({
    extensions: [Document.extend({ content: 'textFile' }), TextFile, Text, UndoRedo],
    content: textFileContent(options.content),
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
