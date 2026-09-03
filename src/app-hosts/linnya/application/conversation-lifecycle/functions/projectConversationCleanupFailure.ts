import {
  ConversationDirectoryError,
  type ConversationDirectoryCleanupFailure,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCleanupFailureStage,
} from '../definitions/conversationCleanupUseCase';

const FALLBACK_CODES: Readonly<Record<
  ConversationCleanupFailureStage,
  string
>> = Object.freeze({
  stop_conversation_activity: 'conversation_activity_stop_failed',
  delete_work_directory: 'work_directory_delete_failed',
  delete_conversation_approvals: 'conversation_approvals_delete_failed',
  delete_command_card_settlements: 'command_card_settlements_delete_failed',
  delete_conversation_facts: 'conversation_facts_delete_failed',
  delete_identity_metadata: 'identity_metadata_delete_failed',
  complete_cleanup_job: 'cleanup_job_complete_failed',
});

export function projectConversationCleanupFailure(input: {
  readonly stage: ConversationCleanupFailureStage;
  readonly error: unknown;
}): ConversationDirectoryCleanupFailure {
  return Object.freeze({
    code: input.error instanceof ConversationDirectoryError
      ? input.error.code
      : FALLBACK_CODES[input.stage],
    stage: input.stage,
  });
}
