import type { MessageCatalogContribution } from '@app/localization';
import type { TableFillMessageKey } from './tableFillMessages';

export const TABLE_FILL_MESSAGE_FALLBACKS = {
  'tableFill.card.step': '填充第 {index} 行',
  'tableFill.context.exitMode': '退出表格AI模式',
  'tableFill.flow.missingProject': '当前版本会话必须依附项目：缺少 projectId，已中止表格填充。',
  'tableFill.flow.missingConversation': '无法获取 conversationId，终止表格填充',
  'tableFill.flow.processingFailed': '处理失败，请稍后重试。',
  'tableFill.tool.write': '写入表格',
  'tableFill.tool.mode.replace': '替换',
  'tableFill.tool.mode.fill': '填充',
  'tableFill.tool.loadingWrite': '正在写入表格...',
  'tableFill.tool.modeLabel': '模式：{mode}',
} as const satisfies Readonly<Record<TableFillMessageKey, string>>;

const TABLE_FILL_ENGLISH_MESSAGES = {
  'tableFill.card.step': 'Fill row {index}',
  'tableFill.context.exitMode': 'Exit table AI mode',
  'tableFill.flow.missingProject': 'This conversation must belong to a project. projectId is missing, so table fill was stopped.',
  'tableFill.flow.missingConversation': 'Could not get conversationId, so table fill was stopped',
  'tableFill.flow.processingFailed': 'Processing failed. Please try again later.',
  'tableFill.tool.write': 'Write to table',
  'tableFill.tool.mode.replace': 'Replace',
  'tableFill.tool.mode.fill': 'Fill',
  'tableFill.tool.loadingWrite': 'Writing to table...',
  'tableFill.tool.modeLabel': 'Mode: {mode}',
} as const satisfies Readonly<Record<TableFillMessageKey, string>>;

export const TABLE_FILL_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'table-fill-workflow',
  catalogs: {
    'zh-CN': TABLE_FILL_MESSAGE_FALLBACKS,
    'en-US': TABLE_FILL_ENGLISH_MESSAGES,
  },
};
