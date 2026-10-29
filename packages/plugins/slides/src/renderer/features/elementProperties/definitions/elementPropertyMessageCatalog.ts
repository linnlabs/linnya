import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type ElementPropertyMessageKey =
  | 'slides.elementProperties.bold'
  | 'slides.elementProperties.italic'
  | 'slides.elementProperties.underline'
  | 'slides.elementProperties.alignment'
  | 'slides.elementProperties.mixed'
  | 'slides.elementProperties.label'
  | 'slides.elementProperties.askAi'
  | 'slides.elementProperties.textAlign.left'
  | 'slides.elementProperties.textAlign.center'
  | 'slides.elementProperties.textAlign.right'
  | 'slides.elementProperties.arrange'
  | 'slides.elementProperties.arrange.toPage'
  | 'slides.elementProperties.arrange.toSelection'
  | 'slides.elementProperties.arrange.left'
  | 'slides.elementProperties.arrange.center'
  | 'slides.elementProperties.arrange.right'
  | 'slides.elementProperties.arrange.top'
  | 'slides.elementProperties.arrange.middle'
  | 'slides.elementProperties.arrange.bottom'
  | 'slides.elementProperties.arrange.distributeX'
  | 'slides.elementProperties.arrange.distributeY'
  | 'slides.elementProperties.layer'
  | 'slides.elementProperties.layer.front'
  | 'slides.elementProperties.layer.forward'
  | 'slides.elementProperties.layer.backward'
  | 'slides.elementProperties.layer.back'
  | 'slides.elementProperties.more'
  | 'slides.elementProperties.copy'
  | 'slides.elementProperties.duplicate'
  | 'slides.elementProperties.copyUnavailable'
  | 'slides.elementProperties.selectionCount'
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
  'slides.elementProperties.bold': '加粗',
  'slides.elementProperties.italic': '斜体',
  'slides.elementProperties.underline': '下划线',
  'slides.elementProperties.alignment': '切换文字对齐',
  'slides.elementProperties.mixed': '混合',
  'slides.elementProperties.label': '元素属性',
  'slides.elementProperties.askAi': '让 AI 修改（⌘K）',
  'slides.elementProperties.textAlign.left': '文字左对齐',
  'slides.elementProperties.textAlign.center': '文字居中',
  'slides.elementProperties.textAlign.right': '文字右对齐',
  'slides.elementProperties.arrange': '排列',
  'slides.elementProperties.arrange.toPage': '对齐到页面',
  'slides.elementProperties.arrange.toSelection': '对齐选中的对象',
  'slides.elementProperties.arrange.left': '左对齐',
  'slides.elementProperties.arrange.center': '水平居中',
  'slides.elementProperties.arrange.right': '右对齐',
  'slides.elementProperties.arrange.top': '顶端对齐',
  'slides.elementProperties.arrange.middle': '垂直居中',
  'slides.elementProperties.arrange.bottom': '底端对齐',
  'slides.elementProperties.arrange.distributeX': '水平等距分布',
  'slides.elementProperties.arrange.distributeY': '垂直等距分布',
  'slides.elementProperties.layer': '图层',
  'slides.elementProperties.layer.front': '置于顶层',
  'slides.elementProperties.layer.forward': '上移一层',
  'slides.elementProperties.layer.backward': '下移一层',
  'slides.elementProperties.layer.back': '置于底层',
  'slides.elementProperties.more': '更多',
  'slides.elementProperties.copy': '复制',
  'slides.elementProperties.duplicate': '创建副本',
  'slides.elementProperties.copyUnavailable': '带复杂样式或位于组内的对象请复制整页',
  'slides.elementProperties.selectionCount': '{count} 个对象',
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
  'slides.elementProperties.bold': 'Bold',
  'slides.elementProperties.italic': 'Italic',
  'slides.elementProperties.underline': 'Underline',
  'slides.elementProperties.alignment': 'Change text alignment',
  'slides.elementProperties.mixed': 'Mixed',
  'slides.elementProperties.label': 'Element properties',
  'slides.elementProperties.askAi': 'Ask AI to edit (⌘K)',
  'slides.elementProperties.textAlign.left': 'Align text left',
  'slides.elementProperties.textAlign.center': 'Center text',
  'slides.elementProperties.textAlign.right': 'Align text right',
  'slides.elementProperties.arrange': 'Arrange',
  'slides.elementProperties.arrange.toPage': 'Align to slide',
  'slides.elementProperties.arrange.toSelection': 'Align selection',
  'slides.elementProperties.arrange.left': 'Align left',
  'slides.elementProperties.arrange.center': 'Align center',
  'slides.elementProperties.arrange.right': 'Align right',
  'slides.elementProperties.arrange.top': 'Align top',
  'slides.elementProperties.arrange.middle': 'Align middle',
  'slides.elementProperties.arrange.bottom': 'Align bottom',
  'slides.elementProperties.arrange.distributeX': 'Distribute horizontally',
  'slides.elementProperties.arrange.distributeY': 'Distribute vertically',
  'slides.elementProperties.layer': 'Layer',
  'slides.elementProperties.layer.front': 'Bring to front',
  'slides.elementProperties.layer.forward': 'Bring forward',
  'slides.elementProperties.layer.backward': 'Send backward',
  'slides.elementProperties.layer.back': 'Send to back',
  'slides.elementProperties.more': 'More',
  'slides.elementProperties.copy': 'Copy',
  'slides.elementProperties.duplicate': 'Duplicate',
  'slides.elementProperties.copyUnavailable': 'Copy the slide to keep complex or grouped objects intact',
  'slides.elementProperties.selectionCount': '{count} objects',
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
