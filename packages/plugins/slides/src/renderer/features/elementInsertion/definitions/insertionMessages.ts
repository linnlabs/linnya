import type { MessageCatalogContribution } from '@plugin/renderer/localization';
export const INSERTION_MESSAGES = {
  'slides.insert.text': '文字', 'slides.insert.rect': '矩形', 'slides.insert.ellipse': '圆形',
  'slides.insert.image': '图片', 'slides.insert.label': '插入', 'slides.insert.placeholder': '输入文字',
  'slides.insert.failed': '图片导入失败，请重试。', 'slides.insert.changed': '文稿已变化，请在目标页重新插入图片。',
  'slides.insert.imageLimit': '请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片。',
} as const;
export const INSERTION_MESSAGE_CATALOG: MessageCatalogContribution = { owner: 'slides-element-insertion', catalogs: {
  'zh-CN': INSERTION_MESSAGES,
  'en-US': { 'slides.insert.text': 'Text', 'slides.insert.rect': 'Rectangle', 'slides.insert.ellipse': 'Circle',
    'slides.insert.image': 'Image', 'slides.insert.label': 'Insert', 'slides.insert.placeholder': 'Type here',
    'slides.insert.failed': 'Image import failed. Please retry.', 'slides.insert.changed': 'The document changed. Insert the image again on the intended slide.',
    'slides.insert.imageLimit': 'Choose a PNG, JPEG or WebP image up to 20 MB.' },
} };
