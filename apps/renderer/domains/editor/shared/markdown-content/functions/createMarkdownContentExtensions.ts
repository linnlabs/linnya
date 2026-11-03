import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { CodeBlock } from '../../../blocks/CodeBlock';
import { getLowlight } from '../../../core/lowlight';
import { FileHtmlBlock } from './fileHtmlBlock';

const MarkdownCodeBlock = CodeBlock.extend({
  group: 'block',
  marks: '',
  addAttributes: () => ({ language: { default: null } }),
});

/** 独立正文共享同一组节点；不包含 Workspace 会话、修订或文件保存副作用。 */
export function createMarkdownContentExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, underline: false, trailingNode: false, link: { openOnClick: false } }),
    MarkdownCodeBlock.configure({ lowlight: getLowlight(), scrollMode: 'external' }),
    TableKit, Image, TaskList, TaskItem.configure({ nested: true }), FileHtmlBlock,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
