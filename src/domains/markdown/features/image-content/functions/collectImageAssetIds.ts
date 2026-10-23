/** 正文、块历史和 Pending 的属性快照使用同一个 assetId 字段。这里只读已持久化的图片事实。 */
export function collectImageAssetIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectImageAssetIds);
  const entries = Object.entries(value);
  const isImage = 'blockType' in value && value.blockType === 'image';
  const id = isImage ? entries.find(([key]) => key === 'assetId')?.[1] : undefined;
  return [
    ...(typeof id === 'string' && id ? [id] : []),
    ...entries.flatMap(([, child]) => collectImageAssetIds(child)),
  ];
}
