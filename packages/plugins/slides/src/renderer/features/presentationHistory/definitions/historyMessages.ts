import type { MessageCatalogContribution } from '@app/localization';
export const SLIDES_HISTORY_FALLBACKS = {
  'slides.history.loading': '正在生成历史预览…',
  'slides.history.failed': '此历史版本无法预览，请刷新历史列表后重试。当前文稿未受影响。',
  'slides.history.empty': '此版本没有幻灯片。',
  'slides.history.readonly': '历史版本只读预览',
  'slides.history.pages': '幻灯片翻页',
  'slides.history.previous': '上一页',
  'slides.history.next': '下一页',
} as const;
export const SLIDES_HISTORY_MESSAGES: MessageCatalogContribution = {
  owner: 'slides-history',
  catalogs: {
    'zh-CN': SLIDES_HISTORY_FALLBACKS,
    'en-US': {
      'slides.history.loading': 'Building version preview…',
      'slides.history.failed':
        'This version could not be previewed. Refresh version history and try again. The current document is unchanged.',
      'slides.history.empty': 'This version has no slides.',
      'slides.history.readonly': 'Read-only version preview',
      'slides.history.pages': 'Slide navigation',
      'slides.history.previous': 'Previous slide',
      'slides.history.next': 'Next slide',
    },
  },
};
