import { Editor } from '@tiptap/vue-3';
import { splitMarkdownFile, joinMarkdownFile } from './markdownFileContent';
import { createMarkdownContentExtensions } from '../../../shared/markdown-content';

export function createMarkdownFileEditor(options: {
  content: string;
  label: string;
  readonly: boolean;
  onChange: (content: string) => void;
}): { editor: Editor; readContent: () => string; replaceContent: (content: string) => void } {
  let original = options.content;
  let file = splitMarkdownFile(original);
  let normalizedBody = '';
  const readContent = () => {
    const body = editor.getMarkdown();
    // 打开、聚焦和撤销到初始状态均保留原始字节，不把序列化差异当作用户修改。
    return body === normalizedBody ? original : joinMarkdownFile(file.prefix, body, file.body);
  };
  const editor = new Editor({
    extensions: createMarkdownContentExtensions(),
    content: file.body,
    contentType: 'markdown',
    editable: !options.readonly,
    editorProps: {
      attributes: { class: 'markdown-file-editor-control', role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label, spellcheck: 'false' },
    },
    onUpdate: () => options.onChange(readContent()),
  });
  normalizedBody = editor.getMarkdown();
  return {
    editor,
    readContent,
    replaceContent(content) {
      if (content === readContent()) return;
      original = content;
      file = splitMarkdownFile(content);
      editor.commands.setContent(file.body, { contentType: 'markdown', emitUpdate: false });
      normalizedBody = editor.getMarkdown();
    },
  };
}
