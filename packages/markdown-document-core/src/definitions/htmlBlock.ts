import { Node } from '@tiptap/core';

/** HTML 源文保留在正文中；默认投影显示转义后的原文，不执行或插入不可信 HTML。 */
export const MarkdownHtmlBlock = Node.create({
  name: 'fileHtmlBlock', group: 'block', atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-markdown-html]', getAttrs: element => ({ source: element.textContent ?? '' }) }],
  renderHTML: ({ node }) => ['pre', { 'data-markdown-html': '' }, typeof node.attrs.source === 'string' ? node.attrs.source : ''],
  markdownTokenName: 'html',
  parseMarkdown: (token, helpers) => helpers.createNode('fileHtmlBlock', { source: token.raw }),
  renderMarkdown: node => typeof node.attrs?.source === 'string' ? node.attrs.source : '',
});
