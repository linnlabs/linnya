import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { CodeBlock } from '../../../blocks/CodeBlock';
import { getLowlight } from '../../../core/lowlight';
import { splitMarkdownFile, joinMarkdownFile } from './markdownFileContent';
import { FileHtmlBlock } from './fileHtmlBlock';

// 独立 Markdown 文件使用标准文档 schema；只复用代码围栏的呈现，不引入 Workspace 块身份与修订。
const MarkdownCodeBlock = CodeBlock.extend({
  group: 'block',
  marks: '',
  addAttributes: () => ({ language: { default: null } }),
});

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
    extensions: [
      StarterKit.configure({ codeBlock: false, underline: false, trailingNode: false, link: { openOnClick: false } }),
      MarkdownCodeBlock.configure({ lowlight: getLowlight(), scrollMode: 'external' }),
      TableKit, Image, TaskList, TaskItem.configure({ nested: true }), FileHtmlBlock,
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
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
