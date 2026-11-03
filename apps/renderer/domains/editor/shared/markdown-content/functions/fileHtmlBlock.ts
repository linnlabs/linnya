import { MarkdownHtmlBlock } from '@linnya/markdown-document-core';
import DOMPurify from 'dompurify';

/** HTML交互预览仍使用Host既有净化器，正文schema归portable core。 */
export const FileHtmlBlock = MarkdownHtmlBlock.extend({
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
