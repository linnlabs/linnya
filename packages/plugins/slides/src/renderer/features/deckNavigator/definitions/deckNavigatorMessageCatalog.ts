import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type DeckNavigatorMessageKey =
  | 'slides.navigator.toolbar.label'
  | 'slides.navigator.insertBlankSlide'
  | 'slides.navigator.insertBlankSlide.inserting'
  | 'slides.navigator.insertBlankSlide.unavailable'
  | 'slides.navigator.view.label'
  | 'slides.navigator.view.slide'
  | 'slides.navigator.view.grid'
  | 'slides.navigator.filmstrip.label'
  | 'slides.navigator.filmstrip.collapse'
  | 'slides.navigator.filmstrip.expand'
  | 'slides.navigator.grid.label'
  | 'slides.navigator.slide.label';

export type DeckNavigatorMessageResolver = (
  key: DeckNavigatorMessageKey,
  params?: MessageParams,
) => string;

export const DECK_NAVIGATOR_MESSAGE_FALLBACKS = {
  'slides.navigator.toolbar.label': '幻灯片导航',
  'slides.navigator.insertBlankSlide': '新建空白幻灯片',
  'slides.navigator.insertBlankSlide.inserting': '正在新建幻灯片…',
  'slides.navigator.insertBlankSlide.unavailable': '文稿就绪后才能新建幻灯片',
  'slides.navigator.view.label': '视图',
  'slides.navigator.view.slide': '单页视图',
  'slides.navigator.view.grid': '平铺视图',
  'slides.navigator.filmstrip.label': '幻灯片列表',
  'slides.navigator.filmstrip.collapse': '收起幻灯片列表',
  'slides.navigator.filmstrip.expand': '展开幻灯片列表',
  'slides.navigator.grid.label': '全部幻灯片',
  'slides.navigator.slide.label': '第 {number} 页',
} as const satisfies Readonly<Record<DeckNavigatorMessageKey, string>>;

const DECK_NAVIGATOR_EN_US_MESSAGES = {
  'slides.navigator.toolbar.label': 'Slide navigation',
  'slides.navigator.insertBlankSlide': 'New blank slide',
  'slides.navigator.insertBlankSlide.inserting': 'Adding slide…',
  'slides.navigator.insertBlankSlide.unavailable': 'Available once the presentation is ready',
  'slides.navigator.view.label': 'View',
  'slides.navigator.view.slide': 'Slide view',
  'slides.navigator.view.grid': 'Grid view',
  'slides.navigator.filmstrip.label': 'Slides',
  'slides.navigator.filmstrip.collapse': 'Hide slide list',
  'slides.navigator.filmstrip.expand': 'Show slide list',
  'slides.navigator.grid.label': 'All slides',
  'slides.navigator.slide.label': 'Slide {number}',
} as const satisfies Readonly<Record<DeckNavigatorMessageKey, string>>;

export const DECK_NAVIGATOR_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-deck-navigator',
  catalogs: {
    'zh-CN': DECK_NAVIGATOR_MESSAGE_FALLBACKS,
    'en-US': DECK_NAVIGATOR_EN_US_MESSAGES,
  },
};
