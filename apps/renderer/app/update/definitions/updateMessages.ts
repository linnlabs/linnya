import type { MessageParams } from '@app/localization';

export type UpdateMessageKey =
  | 'update.entry.available'
  | 'update.entry.downloading'
  | 'update.entry.downloadingUnknown'
  | 'update.entry.paused'
  | 'update.entry.failed'
  | 'update.entry.ready'
  | 'update.entry.readyTooltip'
  | 'update.entry.installing'
  | 'update.panel.downloading.title'
  | 'update.panel.downloading.subtitle'
  | 'update.panel.paused.title'
  | 'update.panel.paused.subtitle'
  | 'update.panel.waitingNetwork'
  | 'update.panel.failed.title'
  | 'update.panel.failed.network'
  | 'update.panel.failed.integrity'
  | 'update.panel.failed.disk'
  | 'update.panel.failed.location'
  | 'update.panel.failed.install'
  | 'update.panel.failed.unknown'
  | 'update.panel.releaseNotes'
  | 'update.panel.speed'
  | 'update.panel.actions.cancelDownload'
  | 'update.panel.actions.cancel'
  | 'update.panel.actions.retry'
  | 'update.restartConfirm.title'
  | 'update.restartConfirm.description'
  | 'update.restartConfirm.changed'
  | 'update.restartConfirm.kind.conversation'
  | 'update.restartConfirm.kind.commands'
  | 'update.restartConfirm.kind.knowledgeIngestion'
  | 'update.restartConfirm.untitledConversation'
  | 'update.restartConfirm.commands'
  | 'update.restartConfirm.knowledgeIngestion'
  | 'update.restartConfirm.actions.later'
  | 'update.restartConfirm.actions.confirm'
  | 'update.installed';

export type UpdateMessageResolver = (
  key: UpdateMessageKey,
  params?: MessageParams,
) => string;
