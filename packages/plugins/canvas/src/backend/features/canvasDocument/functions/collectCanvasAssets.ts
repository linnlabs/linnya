import type { CanvasContentNode, CanvasElement } from '../../../../shared';
export function collectCanvasContentAssetIds(content: CanvasContentNode): string[] {
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode): void => {
    if (node.type === 'image' && typeof node.attrs?.assetId === 'string')
      ids.add(node.attrs.assetId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return [...ids];
}
export function collectCanvasAssetIds(elements: readonly CanvasElement[]): string[] {
  return [
    ...new Set(
      elements.flatMap(element =>
        element.type === 'image'
          ? [element.data.assetId]
          : element.type === 'text'
            ? collectCanvasContentAssetIds(element.data.content)
            : []
      )
    ),
  ];
}

/** 待确认操作也会持有已准备的图片；没有正式元素ID时只提取资源身份。 */
export function collectCanvasCommandAssetIds(
  commands: readonly import('../../../../shared').CanvasCommand[]
): string[] {
  const ids = commands.flatMap(command => {
    if (command.op === 'addImage') return [command.data.assetId];
    if (command.op === 'addText') return collectCanvasContentAssetIds(command.content);
    if (command.op !== 'update' || !command.patch.data) return [];
    const data = command.patch.data;
    if ('assetId' in data) return [data.assetId];
    return 'content' in data ? collectCanvasContentAssetIds(data.content) : [];
  });
  return [...new Set(ids)];
}
