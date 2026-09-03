import type {
  StorageSpaceCategoryKind,
  StorageSpaceConversationWorkFilesState,
} from '@app/schemas';

import type { SettingsMessageKey } from '../../../definitions/settingsMessages';
import type { StorageSpaceClearFailure } from '../store/storageSpaceStore';

const CATEGORY_MESSAGES: Readonly<Record<StorageSpaceCategoryKind, SettingsMessageKey>> = {
  conversation_work_files: 'settings.storageSpace.category.conversationWorkFiles',
  workspace: 'settings.storageSpace.category.workspace',
  attachments: 'settings.storageSpace.category.attachments',
  temporary_outputs: 'settings.storageSpace.category.temporaryOutputs',
  diagnostic_logs: 'settings.storageSpace.category.diagnosticLogs',
  application_data: 'settings.storageSpace.category.applicationData',
};

const STATE_MESSAGES: Readonly<
  Record<StorageSpaceConversationWorkFilesState, SettingsMessageKey>
> = {
  not_created: 'settings.storageSpace.status.notCreated',
  previous_files_unavailable: 'settings.storageSpace.status.previousFilesUnavailable',
  available: 'settings.storageSpace.status.available',
  unavailable: 'settings.storageSpace.status.unavailable',
};

const FAILURE_MESSAGES: Readonly<Record<StorageSpaceClearFailure, SettingsMessageKey>> = {
  not_found: 'settings.storageSpace.failure.notFound',
  deletion_in_progress: 'settings.storageSpace.failure.deletionInProgress',
  failed: 'settings.storageSpace.failure.clearFailed',
};

export function projectStorageCategoryMessage(
  kind: StorageSpaceCategoryKind,
): SettingsMessageKey {
  return CATEGORY_MESSAGES[kind];
}

export function projectStorageWorkFilesStateMessage(
  state: StorageSpaceConversationWorkFilesState,
): SettingsMessageKey {
  return STATE_MESSAGES[state];
}

export function projectStorageClearFailureMessage(
  failure: StorageSpaceClearFailure,
): SettingsMessageKey {
  return FAILURE_MESSAGES[failure];
}
