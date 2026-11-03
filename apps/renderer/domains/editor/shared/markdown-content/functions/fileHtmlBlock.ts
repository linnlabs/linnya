import { Node } from '@tiptap/core';
import DOMPurify from 'dompurify';

/** Markdown 的 HTML 块（包含注释）按原文保留；不能在编辑其他段落时被序列化器悄悄丢弃。 */
export const FileHtmlBlock = Node.create({
  name: 'fileHtmlBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-file-html]', getAttrs: element => ({ source: element.getAttribute('data-file-html') }) }],
  renderHTML: ({ node }) => ['div', { 'data-file-html': node.attrs.source }],
  markdownTokenName: 'html',
  parseMarkdown: (token, helpers) => helpers.createNode('fileHtmlBlock', { source: token.raw }),
  renderMarkdown: node => typeof node.attrs?.source === 'string' ? node.attrs.source : '',
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'markdown-file-html';
      dom.contentEditable = 'false';
      // 原文只用于保存；显示层仍经项目现有净化器，脚本不会进入可执行 DOM。
      dom.innerHTML = DOMPurify.sanitize(typeof node.attrs.source === 'string' ? node.attrs.source : '');
      return { dom };
    };
  },
});
