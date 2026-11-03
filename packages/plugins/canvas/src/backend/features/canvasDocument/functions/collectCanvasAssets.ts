import type { CanvasContentNode, CanvasElement } from '../../../../shared';
export function collectCanvasContentAssetIds(content: CanvasContentNode): string[] {
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode): void => {
    if (node.type === 'image' && typeof node.attrs?.assetId === 'string') ids.add(node.attrs.assetId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(content); return [...ids];
}
export function collectCanvasAssetIds(elements: readonly CanvasElement[]): string[] {
  return [...new Set(elements.flatMap(element => element.type === 'image' ? [element.data.assetId] : element.type === 'text' ? collectCanvasContentAssetIds(element.data.content) : []))];
}
