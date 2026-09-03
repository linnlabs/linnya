import type { MessageParams } from '@app/localization';

export type UpdateMessageKey =
  | 'update.dialog.releaseNotes'
  | 'update.dialog.downloadProgress'
  | 'update.dialog.installing.title'
  | 'update.dialog.installing.description'
  | 'update.dialog.error.title'
  | 'update.dialog.error.default'
  | 'update.dialog.error.ipcUnavailable'
  | 'update.dialog.error.dynamic'
  | 'update.dialog.actions.remindLater'
  | 'update.dialog.actions.updateNow'
  | 'update.dialog.actions.close'
  | 'update.dialog.actions.retry'
  | 'update.dialog.title.installing'
  | 'update.dialog.title.available'
  | 'update.dialog.title.availableWithVersion'
  | 'update.dialog.busy.installingRestart'
  | 'update.dialog.busy.downloading';

export type UpdateMessageResolver = (
  key: UpdateMessageKey,
  params?: MessageParams,
) => string;
