import type {
  ConversationDirectoryCleanupJobPort,
} from '../../../../../domains/conversation-files';

/**
 * History 只需要知道哪些可见对话仍被 cleanup barrier 占用，不取得失败阶段、jobId
 * 或底层目录。这样 Renderer 可以阻止重新进入，同时持久任务仍由唯一 use case 拥有。
 */
export async function readPendingConversationCleanupIds(input: {
  readonly conversationIds: readonly string[];
  readonly jobs: ConversationDirectoryCleanupJobPort;
}): Promise<ReadonlySet<string>> {
  if (input.conversationIds.length === 0) return new Set();
  const requested = new Set(input.conversationIds);
  const pending = new Set<string>();
  for (const job of await input.jobs.list()) {
    if (requested.has(job.conversationId)) pending.add(job.conversationId);
  }
  return pending;
}
