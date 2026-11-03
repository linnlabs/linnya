/** 正文只保存受管身份；运行时资源必须由已授权快照提供，不能从URL推测资产归属。 */
export function hydrateEmbeddedImages(element: HTMLElement, assets: Readonly<Record<string, string>>): void {
  for (const image of element.querySelectorAll('img')) {
    const assetId = image.getAttribute('data-asset-id');
    if (assetId) {
      const source = assets[assetId];
      if (!source) throw new Error('resource_unavailable');
      image.src = source;
    } else {
      const source = image.getAttribute('src');
      if (!source || !source.startsWith('data:') && !source.startsWith('blob:')) throw new Error('resource_unavailable');
    }
  }
}
