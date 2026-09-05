import type { MessageCatalogContribution } from '@app/localization';
export const SLIDES_HISTORY_FALLBACKS = {
  'slides.history.loading': '正在生成历史预览…',
  'slides.history.failed': '此历史版本无法预览，当前文稿未受影响。',
} as const;
export const SLIDES_HISTORY_MESSAGES: MessageCatalogContribution = {
  owner: 'slides-history',
  catalogs: {
    'zh-CN': SLIDES_HISTORY_FALLBACKS,
    'en-US': {
      'slides.history.loading': 'Building version preview…',
      'slides.history.failed':
        'This version could not be previewed. The current document is unchanged.',
    },
  },
};
