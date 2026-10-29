import type { MessageCatalogContribution } from '@plugin/renderer/localization';
export const EDITING_COMMAND_MESSAGES = {
  'slides.editingCommands.paste': '粘贴',
  'slides.editingCommands.label': '幻灯片编辑',
  'slides.editingCommands.undo': '撤销',
  'slides.editingCommands.redo': '重做',
  'slides.editingCommands.editing': '正在编辑',
  'slides.editingCommands.saving': '正在保存…',
  'slides.editingCommands.refreshing': '已保存 · 正在更新画面',
  'slides.editingCommands.saved': '已保存',
  'slides.editingCommands.failed': '尚有未保存的修改',
  'slides.editingCommands.historyUnavailable': '撤销记录暂不可用',
} as const;
export type EditingCommandMessageKey = keyof typeof EDITING_COMMAND_MESSAGES;
export const EDITING_COMMAND_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-editing-commands', catalogs: {
    'zh-CN': EDITING_COMMAND_MESSAGES,
    'en-US': {
      'slides.editingCommands.paste': 'Paste',

      'slides.editingCommands.label': 'Slide editing', 'slides.editingCommands.undo': 'Undo',
      'slides.editingCommands.redo': 'Redo', 'slides.editingCommands.editing': 'Editing',
      'slides.editingCommands.saving': 'Saving…', 'slides.editingCommands.refreshing': 'Saved · Updating preview',
      'slides.editingCommands.saved': 'Saved', 'slides.editingCommands.failed': 'Unsaved changes',
      'slides.editingCommands.historyUnavailable': 'Undo history unavailable',
    },
  },
};
