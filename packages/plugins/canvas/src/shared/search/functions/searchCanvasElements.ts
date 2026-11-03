import type { CanvasContentNode, CanvasElement } from '../../model/definitions/canvasElement';
import type { CanvasSearchContext, CanvasSearchHit } from '../definitions/canvasSearch';

function bodyText(node: CanvasContentNode, context: CanvasSearchContext): string {
  if (node.type === 'documentReference') return typeof node.attrs?.documentId === 'string' ? context.documentTitles.get(node.attrs.documentId) ?? '' : '';
  if (node.type === 'inlineMath' || node.type === 'blockMath') return typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return node.content?.map(child => bodyText(child, context)).join(' ') ?? '';
}
function elementText(element: CanvasElement, context: CanvasSearchContext): string {
  if (element.type === 'text') return bodyText(element.data.content, context);
  if (element.type === 'image') return [element.data.caption, element.data.alt].join(' ');
  if (element.type === 'document') return context.documentTitles.get(element.data.documentId) ?? '';
  return element.label;
}

/** Renderer/CLI共用内容匹配；标题由引用owner显式提供，不从路径或内部ID猜测。 */
export function searchCanvasElements(elements: readonly CanvasElement[], query: string, context: CanvasSearchContext): CanvasSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const ordered = [...elements].sort((a, b) => a.type === 'edge' ? b.type === 'edge' ? 0 : 1 : b.type === 'edge' ? -1 : a.y - b.y || a.x - b.x);
  return ordered.flatMap(element => {
    const text = elementText(element, context), start = text.toLocaleLowerCase().indexOf(needle);
    return start < 0 ? [] : [{ id: element.id, type: element.type, text: text.slice(Math.max(0, start - 36), start + needle.length + 100) }];
  });
}
