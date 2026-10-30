import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type StageZoomMessageKey =
  | 'slides.stageZoom.label'
  | 'slides.stageZoom.zoomOut'
  | 'slides.stageZoom.zoomIn'
  | 'slides.stageZoom.slider'
  | 'slides.stageZoom.menu.label'
  | 'slides.stageZoom.fit'
  | 'slides.stageZoom.percent';

export type StageZoomMessageResolver = (
  key: StageZoomMessageKey,
  params?: MessageParams,
) => string;

export const STAGE_ZOOM_MESSAGE_FALLBACKS = {
  'slides.stageZoom.label': '舞台缩放',
  'slides.stageZoom.zoomOut': '缩小',
  'slides.stageZoom.zoomIn': '放大',
  'slides.stageZoom.slider': '调整缩放比例',
  'slides.stageZoom.menu.label': '缩放比例',
  'slides.stageZoom.fit': '适应窗口',
  'slides.stageZoom.percent': '{percent}%',
} as const satisfies Readonly<Record<StageZoomMessageKey, string>>;

const STAGE_ZOOM_EN_US_MESSAGES = {
  'slides.stageZoom.label': 'Stage zoom',
  'slides.stageZoom.zoomOut': 'Zoom out',
  'slides.stageZoom.zoomIn': 'Zoom in',
  'slides.stageZoom.slider': 'Adjust zoom',
  'slides.stageZoom.menu.label': 'Zoom',
  'slides.stageZoom.fit': 'Fit to window',
  'slides.stageZoom.percent': '{percent}%',
} as const satisfies Readonly<Record<StageZoomMessageKey, string>>;

export const STAGE_ZOOM_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-stage-zoom',
  catalogs: {
    'zh-CN': STAGE_ZOOM_MESSAGE_FALLBACKS,
    'en-US': STAGE_ZOOM_EN_US_MESSAGES,
  },
};
