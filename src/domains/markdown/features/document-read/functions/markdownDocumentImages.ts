import type { MarkdownDocumentImage } from '../../block-content';

export function buildMarkdownDocumentImagesObservation(
  images: readonly MarkdownDocumentImage[],
): string {
  if (images.length === 0) return '';
  const lines = images.map((image, index) => {
    const dimensions = image.width !== undefined && image.height !== undefined
      ? ` (${image.width}×${image.height})`
      : '';
    const alt = image.alt ? ` alt="${image.alt}"` : '';
    return `${index + 1}. blockId="${image.blockId}" locator="${image.locator}"${alt}${dimensions}`;
  });
  return [
    '---',
    `本文档包含 ${images.length} 张图片：`,
    ...lines,
    '提示：当前读取结果只提供图片清单、locator、alt 与尺寸元数据；工具尚未读取图片像素。',
  ].join('\n');
}
