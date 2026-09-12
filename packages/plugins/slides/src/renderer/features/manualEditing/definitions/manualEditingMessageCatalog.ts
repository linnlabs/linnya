import type { MessageCatalogContribution, MessageParams } from '@app/localization';

export type ManualEditingMessageKey =
  | 'slides.manualEditing.toggle.label'
  | 'slides.manualEditing.toggle.enable'
  | 'slides.manualEditing.toggle.disable'
  | 'slides.manualEditing.toggle.saving'
  | 'slides.manualEditing.toggle.unavailable'
  | 'slides.manualEditing.text.ariaLabel'
  | 'slides.manualEditing.text.cancel'
  | 'slides.manualEditing.text.save'
  | 'slides.manualEditing.error.snapshotUnavailable'
  | 'slides.manualEditing.error.draftPresent'
  | 'slides.manualEditing.error.commandReused'
  | 'slides.manualEditing.error.staleBase'
  | 'slides.manualEditing.error.saveFailed';

export type ManualEditingMessageResolver = (
  key: ManualEditingMessageKey,
  params?: MessageParams,
) => string;

export const MANUAL_EDITING_MESSAGE_FALLBACKS = {
  'slides.manualEditing.toggle.label': '有限编辑',
  'slides.manualEditing.toggle.enable': '移动元素；双击纯文本进行编辑',
  'slides.manualEditing.toggle.disable': '关闭有限编辑',
  'slides.manualEditing.toggle.saving': '正在保存人工编辑',
  'slides.manualEditing.toggle.unavailable': '当前页面没有可人工编辑的作者对象',
  'slides.manualEditing.text.ariaLabel': '编辑文本框内容',
  'slides.manualEditing.text.cancel': '取消',
  'slides.manualEditing.text.save': '保存',
  'slides.manualEditing.error.snapshotUnavailable': '页面版本正在更新，请稍后再试。',
  'slides.manualEditing.error.draftPresent': 'AI 编辑产生了待修复草稿，已刷新当前文稿。',
  'slides.manualEditing.error.commandReused': '编辑请求身份发生冲突，请重新操作。',
  'slides.manualEditing.error.staleBase': '文稿已被其他操作更新，已刷新到最新版本。',
  'slides.manualEditing.error.saveFailed': '保存人工编辑失败。',
} as const satisfies Readonly<Record<ManualEditingMessageKey, string>>;

const MANUAL_EDITING_EN_US_MESSAGES = {
  'slides.manualEditing.toggle.label': 'Limited editing',
  'slides.manualEditing.toggle.enable': 'Move elements; double-click plain text to edit',
  'slides.manualEditing.toggle.disable': 'Exit limited editing',
  'slides.manualEditing.toggle.saving': 'Saving manual edit',
  'slides.manualEditing.toggle.unavailable': 'This slide has no manually editable author objects',
  'slides.manualEditing.text.ariaLabel': 'Edit text box content',
  'slides.manualEditing.text.cancel': 'Cancel',
  'slides.manualEditing.text.save': 'Save',
  'slides.manualEditing.error.snapshotUnavailable': 'The slide version is updating. Try again shortly.',
  'slides.manualEditing.error.draftPresent': 'An AI edit has an unresolved draft. The presentation was refreshed.',
  'slides.manualEditing.error.commandReused': 'The edit request identity conflicted. Please try the edit again.',
  'slides.manualEditing.error.staleBase': 'Another operation updated the presentation. The latest version was loaded.',
  'slides.manualEditing.error.saveFailed': 'Failed to save the manual edit.',
} as const satisfies Readonly<Record<ManualEditingMessageKey, string>>;

export const MANUAL_EDITING_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-manual-editing',
  catalogs: {
    'zh-CN': MANUAL_EDITING_MESSAGE_FALLBACKS,
    'en-US': MANUAL_EDITING_EN_US_MESSAGES,
  },
};
