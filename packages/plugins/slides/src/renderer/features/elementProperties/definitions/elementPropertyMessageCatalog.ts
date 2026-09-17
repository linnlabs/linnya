import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type ElementPropertyMessageKey =
  | 'slides.elementProperties.label'
  | 'slides.elementProperties.size'
  | 'slides.elementProperties.deleteElement'
  | 'slides.elementProperties.sizeHint'
  | 'slides.elementProperties.mixedColor'
  | 'slides.elementProperties.colorPlane'
  | 'slides.elementProperties.hue'
  | 'slides.elementProperties.saturation'
  | 'slides.elementProperties.brightness'
  | 'slides.elementProperties.colorMode'
  | 'slides.elementProperties.red'
  | 'slides.elementProperties.green'
  | 'slides.elementProperties.blue'
  | 'slides.elementProperties.invalidRgb'
  | 'slides.elementProperties.hex'
  | 'slides.elementProperties.invalidHex'
  | 'slides.elementProperties.applyColor'
  | 'slides.elementProperties.cancel'
  | 'slides.elementProperties.fontSize'
  | 'slides.elementProperties.textColor'
  | 'slides.elementProperties.fillColor'
  | 'slides.elementProperties.customColor'
  | 'slides.elementProperties.width'
  | 'slides.elementProperties.height'
  | 'slides.elementProperties.deleteFrame';

export type ElementPropertyMessageResolver = (
  key: ElementPropertyMessageKey,
  params?: MessageParams,
) => string;

export const ELEMENT_PROPERTY_MESSAGE_FALLBACKS = {
  'slides.elementProperties.label': '元素属性',
  'slides.elementProperties.size': '尺寸',
  'slides.elementProperties.deleteElement': '删除元素',
  'slides.elementProperties.sizeHint': '拖动右侧、底部或右下角手柄调整尺寸 · 英寸',
  'slides.elementProperties.mixedColor': '非纯色',
  'slides.elementProperties.colorPlane': '选择饱和度与明度',
  'slides.elementProperties.hue': '色相',
  'slides.elementProperties.saturation': '饱和度',
  'slides.elementProperties.brightness': '明度',
  'slides.elementProperties.colorMode': '颜色模式',
  'slides.elementProperties.red': '红',
  'slides.elementProperties.green': '绿',
  'slides.elementProperties.blue': '蓝',
  'slides.elementProperties.invalidRgb': 'RGB 各通道请输入 0–255 的整数',
  'slides.elementProperties.hex': 'HEX 颜色',
  'slides.elementProperties.invalidHex': '请输入六位 HEX 颜色，例如 #2563EB',
  'slides.elementProperties.applyColor': '应用颜色',
  'slides.elementProperties.cancel': '取消',
  'slides.elementProperties.fontSize': '字号',
  'slides.elementProperties.textColor': '文字颜色',
  'slides.elementProperties.fillColor': '填充颜色',
  'slides.elementProperties.customColor': '自定义颜色',
  'slides.elementProperties.width': '宽',
  'slides.elementProperties.height': '高',
  'slides.elementProperties.deleteFrame': '删除 Frame 及其中所有元素',
} as const satisfies Readonly<Record<ElementPropertyMessageKey, string>>;

const ELEMENT_PROPERTY_EN_US_MESSAGES = {
  'slides.elementProperties.label': 'Element properties',
  'slides.elementProperties.size': 'Size',
  'slides.elementProperties.deleteElement': 'Delete element',
  'slides.elementProperties.sizeHint': 'Drag the right, bottom or bottom-right handle · inches',
  'slides.elementProperties.mixedColor': 'Non-solid',
  'slides.elementProperties.colorPlane': 'Choose saturation and brightness',
  'slides.elementProperties.hue': 'Hue',
  'slides.elementProperties.saturation': 'Saturation',
  'slides.elementProperties.brightness': 'Brightness',
  'slides.elementProperties.colorMode': 'Color mode',
  'slides.elementProperties.red': 'R',
  'slides.elementProperties.green': 'G',
  'slides.elementProperties.blue': 'B',
  'slides.elementProperties.invalidRgb': 'Enter whole numbers from 0 to 255 for each RGB channel',
  'slides.elementProperties.hex': 'HEX color',
  'slides.elementProperties.invalidHex': 'Enter six HEX digits, for example #2563EB',
  'slides.elementProperties.applyColor': 'Apply color',
  'slides.elementProperties.cancel': 'Cancel',
  'slides.elementProperties.fontSize': 'Font size',
  'slides.elementProperties.textColor': 'Text color',
  'slides.elementProperties.fillColor': 'Fill color',
  'slides.elementProperties.customColor': 'Custom color',
  'slides.elementProperties.width': 'Width',
  'slides.elementProperties.height': 'Height',
  'slides.elementProperties.deleteFrame': 'Delete Frame and all its elements',
} as const satisfies Readonly<Record<ElementPropertyMessageKey, string>>;

export const ELEMENT_PROPERTY_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-element-properties',
  catalogs: {
    'zh-CN': ELEMENT_PROPERTY_MESSAGE_FALLBACKS,
    'en-US': ELEMENT_PROPERTY_EN_US_MESSAGES,
  },
};
