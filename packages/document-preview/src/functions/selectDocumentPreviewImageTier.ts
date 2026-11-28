import { DOCUMENT_PREVIEW_IMAGE_TIERS, type DocumentPreviewImageTier } from '@app/schemas';

/** 取不小于实际输出像素（长边）的最小一档；超过最大档时用最大档，不为预览取原图。 */
export function selectDocumentPreviewImageTier(longEdgePx: number): DocumentPreviewImageTier {
  return (
    DOCUMENT_PREVIEW_IMAGE_TIERS.find(tier => tier >= longEdgePx) ??
    DOCUMENT_PREVIEW_IMAGE_TIERS[DOCUMENT_PREVIEW_IMAGE_TIERS.length - 1]
  );
}
