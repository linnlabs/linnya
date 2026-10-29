import type { MessageCatalogContribution } from '@plugin/renderer/localization';
export const IMAGE_EDITING_MESSAGES = { replaceImage: '替换图片', imageFit: '图片适应', contain: '完整显示', cover: '居中裁剪填满',
  imageLimit: '请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片。', changed: '文稿已变化，请重新选择图片。', failed: '图片导入失败，请重试。' } as const;
export type ImageEditingMessageKey = keyof typeof IMAGE_EDITING_MESSAGES;
const en: Record<ImageEditingMessageKey, string> = { replaceImage: 'Replace image', imageFit: 'Image fit', contain: 'Fit entire image', cover: 'Center crop to fill',
  imageLimit: 'Choose a PNG, JPEG or WebP up to 20 MB.', changed: 'The document changed. Please choose the image again.', failed: 'Image import failed. Please retry.' };
export const IMAGE_EDITING_MESSAGE_CATALOG: MessageCatalogContribution = { owner: 'slides-image-editing', catalogs: {
  'zh-CN': Object.fromEntries(Object.entries(IMAGE_EDITING_MESSAGES).map(([key, value]) => [`slides.imageEditing.${key}`, value])),
  'en-US': Object.fromEntries(Object.entries(en).map(([key, value]) => [`slides.imageEditing.${key}`, value])),
} };
