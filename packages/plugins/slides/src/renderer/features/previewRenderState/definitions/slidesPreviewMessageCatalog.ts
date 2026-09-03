import type {
  MessageCatalogContribution,
  MessageParams,
} from '@app/localization';

export type SlidesPreviewMessageKey =
  | 'slides.preview.error.presentationRendering'
  | 'slides.preview.error.slideRendering'
  | 'slides.preview.empty.noSlides';

export type SlidesPreviewMessageResolver = (
  key: SlidesPreviewMessageKey,
  params?: MessageParams,
) => string;

export const SLIDES_PREVIEW_MESSAGE_FALLBACKS = {
  'slides.preview.error.presentationRendering': '演示文稿渲染失败',
  'slides.preview.error.slideRendering': '幻灯片渲染失败',
  'slides.preview.empty.noSlides': '暂无幻灯片',
} as const satisfies Readonly<Record<SlidesPreviewMessageKey, string>>;

const SLIDES_PREVIEW_EN_US_MESSAGES = {
  'slides.preview.error.presentationRendering': 'Presentation rendering failed',
  'slides.preview.error.slideRendering': 'Slide rendering failed',
  'slides.preview.empty.noSlides': 'No slides',
} as const satisfies Readonly<Record<SlidesPreviewMessageKey, string>>;

export const SLIDES_PREVIEW_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-preview',
  catalogs: {
    'zh-CN': SLIDES_PREVIEW_MESSAGE_FALLBACKS,
    'en-US': SLIDES_PREVIEW_EN_US_MESSAGES,
  },
};
