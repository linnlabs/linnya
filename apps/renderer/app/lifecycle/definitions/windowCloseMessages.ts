import type { MessageParams } from '@app/localization';

export type WindowCloseMessageKey =
  | 'windowClose.exit.title'
  | 'windowClose.running.commands'
  | 'windowClose.running.scheduled'
  | 'windowClose.running.commandsAndScheduled'
  | 'windowClose.running.confirm'
  | 'windowClose.unknown.message'
  | 'windowClose.saveFailed.title'
  | 'windowClose.saveFailed.message'
  | 'windowClose.confirm.exit'
  | 'windowClose.confirm.restartUpdate'
  | 'windowClose.cancel';

export type WindowCloseMessageResolver = (key: WindowCloseMessageKey, params?: MessageParams) => string;
