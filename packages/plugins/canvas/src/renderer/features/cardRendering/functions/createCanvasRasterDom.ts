import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import { JsonValueSchema } from '@app/schemas';
import type { CanvasCardRasterInput } from '../definitions/canvasCardRasterization';

/** 默认正文路径供独立渲染/性能入口使用，媒体来源由正式content port注入。 */
export function createCanvasRasterDom(input: CanvasCardRasterInput): HTMLElement {
  const element = document.createElement('div');
  if (input.card.type === 'text') element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(input.card.data.content), document));
  else element.textContent = input.card.type === 'document' ? '文档' : input.card.data.caption || '图片';
  return element;
}
