import type {
  ConversationWorkDirectoryResolution,
} from '../../../../../domains/conversation-files';
import type {
  ConversationPersistenceAdmission,
  ConversationWorkFilesStatus,
} from '../definitions/conversationPersistenceAdmission';

function projectWorkFilesStatus(input: {
  readonly conversationExisted: boolean;
  readonly directory: ConversationWorkDirectoryResolution;
}): ConversationWorkFilesStatus {
  if (input.directory.status === 'recreated_missing') {
    return 'previous_files_unavailable';
  }
  if (input.conversationExisted && input.directory.status === 'created') {
    return 'historical_files_unavailable';
  }
  return 'ready';
}

export function projectConversationPersistenceAdmission(input: {
  readonly conversationExisted: boolean;
  readonly directory: ConversationWorkDirectoryResolution;
}): ConversationPersistenceAdmission {
  return Object.freeze({
    conversationStatus: input.conversationExisted ? 'existing' : 'created',
    workFilesStatus: projectWorkFilesStatus(input),
    directory: input.directory,
  });
}
