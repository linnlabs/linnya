import {
  ConversationDirectoryCleanupFailureSchema,
  ConversationDirectoryCleanupJobError,
  ConversationDirectoryCleanupJobSchema,
  type ConversationDirectoryCleanupFailure,
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobBeginResult,
  type ConversationDirectoryCleanupJobFailureStage,
  type ConversationDirectoryCleanupJobScope,
  type ConversationDirectoryCleanupJobWithFailure,
  type ConversationDirectoryCleanupOperation,
} from '../../../definitions/conversationDirectoryCleanupJob';
import type {
  ConversationWorkDirectoryIdentity,
} from '../../../definitions/conversationWorkDirectory';

export function createConversationDirectoryCleanupJob(input: {
  readonly jobId: unknown;
  readonly identity: ConversationWorkDirectoryIdentity;
  readonly operation: ConversationDirectoryCleanupOperation;
  readonly requestedAt: number;
}): ConversationDirectoryCleanupJob {
  const parsed = ConversationDirectoryCleanupJobSchema.safeParse({
    jobId: input.jobId,
    conversationId: input.identity.conversationId,
    operation: input.operation,
    requestedAt: input.requestedAt,
    retryCount: 0,
  });
  if (!parsed.success) {
    throw new ConversationDirectoryCleanupJobError('invalid_cleanup_job', 'begin');
  }
  return Object.freeze(parsed.data);
}

export function parseStoredConversationDirectoryCleanupJob(
  value: unknown,
  stage: ConversationDirectoryCleanupJobFailureStage,
): ConversationDirectoryCleanupJob {
  const parsed = ConversationDirectoryCleanupJobSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConversationDirectoryCleanupJobError('cleanup_job_corrupt', stage);
  }
  return Object.freeze(parsed.data);
}

/** 删除整个对话支配仅清理目录；持久任务不能被后来的较窄请求降级。 */
export function resolveConversationDirectoryCleanupJobBegin(input: {
  readonly existing: ConversationDirectoryCleanupJob | null;
  readonly requested: ConversationDirectoryCleanupJob;
}): ConversationDirectoryCleanupJobBeginResult {
  if (!input.existing) {
    return Object.freeze({ status: 'created', job: input.requested });
  }

  if (
    input.existing.operation === 'clear_work_directory'
    && input.requested.operation === 'delete_conversation'
  ) {
    return Object.freeze({
      status: 'upgraded',
      job: Object.freeze({
        ...input.existing,
        operation: 'delete_conversation',
      }),
    });
  }

  return Object.freeze({ status: 'existing', job: input.existing });
}

export function advanceConversationDirectoryCleanupFailure(input: {
  readonly existing: ConversationDirectoryCleanupJob | null;
  readonly scope: ConversationDirectoryCleanupJobScope;
  readonly failure: ConversationDirectoryCleanupFailure;
}): ConversationDirectoryCleanupJobWithFailure | null {
  if (
    !input.existing
    || input.existing.jobId !== input.scope.jobId
    || input.existing.conversationId !== input.scope.conversationId
    || input.existing.operation !== input.scope.operation
  ) {
    return null;
  }

  const failure = ConversationDirectoryCleanupFailureSchema.safeParse(input.failure);
  if (!failure.success) {
    throw new ConversationDirectoryCleanupJobError(
      'invalid_cleanup_job',
      'record_failure',
    );
  }

  return Object.freeze({
    ...input.existing,
    retryCount: input.existing.retryCount + 1,
    lastFailure: Object.freeze(failure.data),
  });
}
