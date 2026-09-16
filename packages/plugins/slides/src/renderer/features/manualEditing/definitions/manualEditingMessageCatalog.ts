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
  | 'slides.manualEditing.text.saving'
  | 'slides.manualEditing.hierarchy.ariaLabel'
  | 'slides.manualEditing.resize.right'
  | 'slides.manualEditing.resize.bottom'
  | 'slides.manualEditing.resize.corner'
  | 'slides.manualEditing.error.snapshotUnavailable'
  | 'slides.manualEditing.error.draftPresent'
  | 'slides.manualEditing.error.commandReused'
  | 'slides.manualEditing.error.staleBase'
  | 'slides.manualEditing.error.saveFailed'
  | 'slides.manualEditing.error.presentationRefreshFailed'
  | 'slides.manualEditing.refreshPresentation'
  | 'slides.manualEditing.error.dependentEditsBlocked'
  | 'slides.manualEditing.error.textDraftRetained';

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
  'slides.manualEditing.text.saving': '保存中…',
  'slides.manualEditing.hierarchy.ariaLabel': '元素层级',
  'slides.manualEditing.resize.right': '调整宽度',
  'slides.manualEditing.resize.bottom': '调整高度',
  'slides.manualEditing.resize.corner': '调整宽度和高度',
  'slides.manualEditing.error.snapshotUnavailable': '页面版本正在更新，请稍后再试。',
  'slides.manualEditing.error.draftPresent': 'AI 编辑产生了待修复草稿，已刷新当前文稿。',
  'slides.manualEditing.error.commandReused': '编辑请求身份发生冲突，请重新操作。',
  'slides.manualEditing.error.staleBase': '文稿已被其他操作更新，已刷新到最新版本。',
  'slides.manualEditing.error.saveFailed': '保存人工编辑失败。',
  'slides.manualEditing.error.presentationRefreshFailed': '修改已保存，但画面刷新失败。可重试刷新，或继续选择和编辑。',
  'slides.manualEditing.refreshPresentation': '重试刷新',
  'slides.manualEditing.error.dependentEditsBlocked': '后续修改尚未提交，请重新操作。',
  'slides.manualEditing.error.textDraftRetained': '未保存文字已保留，双击相应元素可继续编辑。',
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
  'slides.manualEditing.text.saving': 'Saving…',
  'slides.manualEditing.hierarchy.ariaLabel': 'Element hierarchy',
  'slides.manualEditing.resize.right': 'Resize width',
  'slides.manualEditing.resize.bottom': 'Resize height',
  'slides.manualEditing.resize.corner': 'Resize width and height',
  'slides.manualEditing.error.snapshotUnavailable': 'The slide version is updating. Try again shortly.',
  'slides.manualEditing.error.draftPresent': 'An AI edit has an unresolved draft. The presentation was refreshed.',
  'slides.manualEditing.error.commandReused': 'The edit request identity conflicted. Please try the edit again.',
  'slides.manualEditing.error.staleBase': 'Another operation updated the presentation. The latest version was loaded.',
  'slides.manualEditing.error.saveFailed': 'Failed to save the manual edit.',
  'slides.manualEditing.error.presentationRefreshFailed': 'Changes saved, but the preview refresh failed. Retry refreshing or continue editing.',
  'slides.manualEditing.refreshPresentation': 'Retry refresh',
  'slides.manualEditing.error.dependentEditsBlocked': 'Later edits were not submitted. Please apply them again.',
  'slides.manualEditing.error.textDraftRetained': 'Unsaved text was retained. Double-click the object to continue editing.',
} as const satisfies Readonly<Record<ManualEditingMessageKey, string>>;

export const MANUAL_EDITING_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-manual-editing',
  catalogs: {
    'zh-CN': MANUAL_EDITING_MESSAGE_FALLBACKS,
    'en-US': MANUAL_EDITING_EN_US_MESSAGES,
  },
};
