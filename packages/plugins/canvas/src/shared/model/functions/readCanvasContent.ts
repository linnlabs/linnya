import type { CanvasContentNode, CanvasElement, CanvasTextDocument } from '../definitions/canvasElement';

/** 只有序列化/搜索派生值读文字；所有编辑仍回到结构化正文。 */
export function readCanvasNodeText(node: CanvasContentNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'documentReference') return String(node.attrs?.label ?? '文档');
  if (node.type === 'hardBreak') return '\n';
  const separator = ['doc', 'bulletList', 'orderedList', 'taskList', 'blockquote'].includes(node.type) ? '\n' : '';
  return (node.content ?? []).map(readCanvasNodeText).join(separator);
}

export function readCanvasElementText(element: CanvasElement): string {
  switch (element.type) {
    case 'text': return readCanvasNodeText(element.data.content);
    case 'image': return element.data.caption || element.data.alt;
    case 'document': return '文档';
    case 'edge': return element.label;
  }
}

export function createCanvasPlainTextDocument(text: string): CanvasTextDocument {
  return { type: 'doc', content: text.split('\n').map(line => ({
    type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
  })) };
}
