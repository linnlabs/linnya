import type { Extensions } from '@tiptap/core';
import { createMarkdownDocumentExtensions } from '@linnya/markdown-document-core';
import { CodeBlock } from '../../../blocks/CodeBlock';
import { getLowlight } from '../../../core/lowlight';
import { FileHtmlBlock } from './fileHtmlBlock';

const MarkdownCodeBlock = CodeBlock.extend({
  group: 'block', marks: '', addAttributes: () => ({ language: { default: null } }),
});

/** 正文定义归 portable core；Editor 只替换代码/HTML 的交互表现。 */
export function createMarkdownContentExtensions(): Extensions {
  return createMarkdownDocumentExtensions([
    MarkdownCodeBlock.configure({ lowlight: getLowlight(), scrollMode: 'external' }), FileHtmlBlock,
  ]);
}
