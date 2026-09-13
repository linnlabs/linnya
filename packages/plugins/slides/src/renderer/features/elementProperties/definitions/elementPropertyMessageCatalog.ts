import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type ElementPropertyMessageKey =
  | 'slides.elementProperties.label'
  | 'slides.elementProperties.fontSize'
  | 'slides.elementProperties.textColor'
  | 'slides.elementProperties.fillColor'
  | 'slides.elementProperties.customColor'
  | 'slides.elementProperties.width'
  | 'slides.elementProperties.height'
  | 'slides.elementProperties.applySize'
  | 'slides.elementProperties.deleteFrame';

export type ElementPropertyMessageResolver = (
  key: ElementPropertyMessageKey,
  params?: MessageParams,
) => string;

export const ELEMENT_PROPERTY_MESSAGE_FALLBACKS = {
  'slides.elementProperties.label': '元素属性',
  'slides.elementProperties.fontSize': '字号',
  'slides.elementProperties.textColor': '文字颜色',
  'slides.elementProperties.fillColor': '填充颜色',
  'slides.elementProperties.customColor': '自定义颜色',
  'slides.elementProperties.width': '宽',
  'slides.elementProperties.height': '高',
  'slides.elementProperties.applySize': '应用尺寸',
  'slides.elementProperties.deleteFrame': '删除 Frame 及其中所有元素',
} as const satisfies Readonly<Record<ElementPropertyMessageKey, string>>;

const ELEMENT_PROPERTY_EN_US_MESSAGES = {
  'slides.elementProperties.label': 'Element properties',
  'slides.elementProperties.fontSize': 'Font size',
  'slides.elementProperties.textColor': 'Text color',
  'slides.elementProperties.fillColor': 'Fill color',
  'slides.elementProperties.customColor': 'Custom color',
  'slides.elementProperties.width': 'Width',
  'slides.elementProperties.height': 'Height',
  'slides.elementProperties.applySize': 'Apply size',
  'slides.elementProperties.deleteFrame': 'Delete Frame and all its elements',
} as const satisfies Readonly<Record<ElementPropertyMessageKey, string>>;

export const ELEMENT_PROPERTY_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-element-properties',
  catalogs: {
    'zh-CN': ELEMENT_PROPERTY_MESSAGE_FALLBACKS,
    'en-US': ELEMENT_PROPERTY_EN_US_MESSAGES,
  },
};
