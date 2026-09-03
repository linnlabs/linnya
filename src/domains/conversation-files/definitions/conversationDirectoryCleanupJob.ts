import { z } from 'zod';

import {
  ConversationWorkDirectoryConversationIdSchema,
} from './conversationWorkDirectory';

const RANDOM_UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** 每次首次建立任务时生成；旧任务的迟到回调不得操作同一对话的下一代任务。 */
export const ConversationDirectoryCleanupJobIdSchema = z.string()
  .regex(new RegExp(`^conversation_cleanup_${RANDOM_UUID_PATTERN}$`))
  .brand<'ConversationDirectoryCleanupJobId'>();
export type ConversationDirectoryCleanupJobId = z.infer<
  typeof ConversationDirectoryCleanupJobIdSchema
>;

export const ConversationDirectoryCleanupOperationSchema = z.enum([
  'clear_work_directory',
  'delete_conversation',
]);
export type ConversationDirectoryCleanupOperation = z.infer<
  typeof ConversationDirectoryCleanupOperationSchema
>;

export const ConversationDirectoryCleanupFailureSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  // 任务表只持久化失败信封；具体跨 domain 步骤由 application use case 定义。
  stage: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
}).strict();
export type ConversationDirectoryCleanupFailure = z.infer<
  typeof ConversationDirectoryCleanupFailureSchema
>;

export const ConversationDirectoryCleanupJobSchema = z.object({
  jobId: ConversationDirectoryCleanupJobIdSchema,
  conversationId: ConversationWorkDirectoryConversationIdSchema,
  operation: ConversationDirectoryCleanupOperationSchema,
  requestedAt: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  lastFailure: ConversationDirectoryCleanupFailureSchema.optional(),
}).strict();
export type ConversationDirectoryCleanupJob = z.infer<
  typeof ConversationDirectoryCleanupJobSchema
>;

export type ConversationDirectoryCleanupJobWithFailure = ConversationDirectoryCleanupJob & {
  readonly lastFailure: ConversationDirectoryCleanupFailure;
};

export interface ConversationDirectoryCleanupJobScope {
  readonly jobId: ConversationDirectoryCleanupJob['jobId'];
  readonly conversationId: ConversationDirectoryCleanupJob['conversationId'];
  readonly operation: ConversationDirectoryCleanupOperation;
}

export type ConversationDirectoryCleanupJobBeginStatus =
  | 'created'
  | 'existing'
  | 'upgraded';

export interface ConversationDirectoryCleanupJobBeginResult {
  readonly status: ConversationDirectoryCleanupJobBeginStatus;
  readonly job: ConversationDirectoryCleanupJob;
}

export type ConversationDirectoryCleanupJobFailureCode =
  | 'invalid_cleanup_job'
  | 'cleanup_job_corrupt'
  | 'cleanup_job_persistence_failed';

export type ConversationDirectoryCleanupJobFailureStage =
  | 'begin'
  | 'read'
  | 'list'
  | 'record_failure'
  | 'complete';

export class ConversationDirectoryCleanupJobError extends Error {
  constructor(
    readonly code: ConversationDirectoryCleanupJobFailureCode,
    readonly stage: ConversationDirectoryCleanupJobFailureStage,
    readonly storageCode?: string,
  ) {
    super(`${code} at ${stage}`);
    this.name = 'ConversationDirectoryCleanupJobError';
  }
}
