import type { MessageParams } from '@app/localization';

export type TableFillMessageKey =
  | 'tableFill.card.step'
  | 'tableFill.context.exitMode'
  | 'tableFill.flow.missingProject'
  | 'tableFill.flow.missingConversation'
  | 'tableFill.flow.processingFailed'
  | 'tableFill.tool.write'
  | 'tableFill.tool.mode.replace'
  | 'tableFill.tool.mode.fill'
  | 'tableFill.tool.loadingWrite'
  | 'tableFill.tool.modeLabel';

export type TableFillMessageResolver = (
  key: TableFillMessageKey,
  params?: MessageParams,
) => string;
