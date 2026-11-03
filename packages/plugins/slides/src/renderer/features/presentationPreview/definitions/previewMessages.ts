import type { MessageCatalogContribution } from '@app/localization';
export const SLIDES_PREVIEW_FALLBACKS = {
  'slides.preview.loading': '正在生成只读预览…',
  'slides.preview.failed': '文档预览暂不可用，请重新打开预览。',
  'slides.preview.empty': '此文稿没有幻灯片。',
  'slides.preview.readonly': '演示文稿只读预览',
  'slides.preview.pages': '幻灯片翻页',
  'slides.preview.previous': '上一页',
  'slides.preview.next': '下一页',
} as const;
export const SLIDES_PREVIEW_MESSAGES: MessageCatalogContribution = {
  owner: 'slides-preview',
  catalogs: {
    'zh-CN': SLIDES_PREVIEW_FALLBACKS,
    'en-US': {
      'slides.preview.loading': 'Building read-only preview…',
      'slides.preview.failed': 'Document preview is unavailable. Reopen the preview to try again.',
      'slides.preview.empty': 'This presentation has no slides.',
      'slides.preview.readonly': 'Read-only presentation preview',
      'slides.preview.pages': 'Slide navigation',
      'slides.preview.previous': 'Previous slide',
      'slides.preview.next': 'Next slide',
    },
  },
};
