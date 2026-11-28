import type { DocumentPreviewRequest } from '@app/schemas';

/** 封面的固定宽度档（CSS 像素）；上限与请求合同的最大宽度一致。 */
const COVER_WIDTH_TIERS = [320, 640, 1280, 1600] as const;

/**
 * 把请求的宽度和像素比归到固定档位，再交给按尺寸出图的类型（演示稿、画布）。
 * 封面在各入口都按容器宽度缩放显示：悬停固定要 640，画布卡要的是卡片宽度，拖一下卡片边就是一个新宽度。
 * 不归档的话每个宽度都要重新出一次图、各占一份缓存。宽度向上取档，像素比只分 1 倍和 2 倍，所以不会比请求的糊。
 */
export function resolveDocumentPreviewCoverSize(
  request: Pick<DocumentPreviewRequest, 'widthPx' | 'pixelRatio'>
): Pick<DocumentPreviewRequest, 'widthPx' | 'pixelRatio'> {
  return {
    widthPx: COVER_WIDTH_TIERS.find(tier => tier >= request.widthPx) ?? 1600,
    pixelRatio: request.pixelRatio > 1 ? 2 : 1,
  };
}
