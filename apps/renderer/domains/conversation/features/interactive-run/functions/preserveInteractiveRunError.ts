import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';

/**
 * 控制面刷新不拥有关闭错误提示的权限。只保留同一 execution 已接纳的提示，
 * 新运行/新 execution 不能继承旧错误；主动关闭和重试由各自 command 清除。
 */
export function preserveInteractiveRunError(
  current: InteractiveRunSnapshot | undefined,
  next: InteractiveRunSnapshot,
): InteractiveRunSnapshot {
  if (
    next.error !== undefined || !current?.error || !current.runId || !current.executionId ||
    next.conversationId !== current.conversationId ||
    next.runId !== current.runId || next.executionId !== current.executionId
  ) return next;
  return { ...next, error: current.error };
}
