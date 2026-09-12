import type {
  ConversationControlExecutionProgressSnapshot,
  ConversationControlRunRecord,
} from '../definitions/conversationControlUseCase';

/**
 * RunRegistry 拥有生命周期，execution progress 只补充同一次 running activation
 * 已经持久化的 Graph 位置。恢复执行前留下的旧快照不得覆盖新的运行状态。
 */
export function projectActiveExecutionProgress(
  run: ConversationControlRunRecord,
  progress: ConversationControlExecutionProgressSnapshot | null,
): ConversationControlRunRecord {
  if (run.status !== 'running' || !progress || progress.savedAt < run.updatedAt) {
    return run;
  }

  return {
    ...run,
    currentNode: progress.currentNode ?? run.currentNode,
    runIterationsUsed: progress.runIterationsUsed ?? run.runIterationsUsed,
    iterationsUsed: progress.runIterationsUsed ?? run.iterationsUsed,
  };
}
