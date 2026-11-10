import type { StorageSpaceCategoryKind } from '@app/schemas';

import type { SettingsMessageKey } from '../../../definitions/settingsMessages';

const CATEGORY_MESSAGES: Readonly<Record<StorageSpaceCategoryKind, SettingsMessageKey>> = {
  conversation_work_files: 'settings.storageSpace.category.conversationWorkFiles',
  workspace: 'settings.storageSpace.category.workspace',
  attachments: 'settings.storageSpace.category.attachments',
  temporary_outputs: 'settings.storageSpace.category.temporaryOutputs',
  diagnostic_logs: 'settings.storageSpace.category.diagnosticLogs',
  application_data: 'settings.storageSpace.category.applicationData',
};

export function projectStorageCategoryMessage(
  kind: StorageSpaceCategoryKind,
): SettingsMessageKey {
  return CATEGORY_MESSAGES[kind];
}
