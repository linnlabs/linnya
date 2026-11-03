import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { DocumentReferenceNode } from '../definitions/documentReference';
import { MarkdownHtmlBlock } from '../definitions/htmlBlock';

/** overrides 只替换同名呈现扩展，正文节点与 Markdown handler 由本包唯一拥有。 */
export function createMarkdownDocumentExtensions(overrides: Extensions = []): Extensions {
  const replacements = new Map(overrides.map(extension => [extension.name, extension]));
  const base: Extensions = [
    StarterKit.configure({ codeBlock: false, underline: false, trailingNode: false, link: { openOnClick: false } }),
    CodeBlock, TableKit, Image, TaskList, TaskItem.configure({ nested: true }), MarkdownHtmlBlock, DocumentReferenceNode,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
  const names = new Set(base.map(extension => extension.name));
  return [...base.map(extension => replacements.get(extension.name) ?? extension), ...overrides.filter(extension => !names.has(extension.name))];
}
