import { z } from 'zod';

import type {
  ConversationDirectoryCleanupFailure,
  ConversationDirectoryCleanupJob,
} from '../../../../../domains/conversation-files';

export const ConversationCleanupFailureStageSchema = z.enum([
  'stop_conversation_activity',
  'delete_work_directory',
  'delete_conversation_approvals',
  'delete_command_card_settlements',
  'delete_conversation_facts',
  'delete_identity_metadata',
  'complete_cleanup_job',
]);
export type ConversationCleanupFailureStage = z.infer<
  typeof ConversationCleanupFailureStageSchema
>;

export type ConversationCleanupExecutionStatus =
  | 'completed'
  | 'completed_by_other_worker'
  | 'superseded';

export interface ConversationCleanupRecoveryFailure {
  readonly job: ConversationDirectoryCleanupJob;
  readonly failure: ConversationDirectoryCleanupFailure;
}

export interface ConversationCleanupRecoverySummary {
  readonly listedCount: number;
  readonly completedCount: number;
  readonly supersededCount: number;
  readonly failures: readonly ConversationCleanupRecoveryFailure[];
}

/**
 * 原步骤失败与“把失败写回持久 job”可能同时失败，二者必须同时保留，不能让次生的
 * SQLite 错误覆盖真正的目录或活动收尾错误。
 */
export class ConversationCleanupUseCaseError extends Error {
  constructor(
    readonly failure: ConversationDirectoryCleanupFailure,
    readonly operationError: unknown,
    readonly failurePersistenceError?: unknown,
  ) {
    super(`${failure.code} at ${failure.stage}`);
    this.name = 'ConversationCleanupUseCaseError';
  }
}
