import type {
  ConversationSurfaceError,
  ConversationSurfaceErrorCandidates,
  ConversationSurfaceErrorSource,
} from '../definitions/conversationSurfaceError';

function nonEmptyMessage(message: string | null | undefined): string | undefined {
  if (typeof message !== 'string') return undefined;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createCandidate(
  source: ConversationSurfaceErrorSource,
  message: string | null | undefined,
): ConversationSurfaceError | null {
  const normalized = nonEmptyMessage(message);
  return normalized ? { source, message: normalized } : null;
}

/**
 * 只决定横幅当前显示哪一个错误，不修改任何执行状态。
 * 前台 run 优先，其次是保留中的旧 execution，最后是批注 run；关闭动作按返回的 source 定向执行。
 */
export function selectConversationSurfaceError(
  candidates: ConversationSurfaceErrorCandidates,
): ConversationSurfaceError | null {
  const choices = [
    createCandidate('interactive-run', candidates.interactiveRun),
    createCandidate('legacy-execution', candidates.legacyExecution),
    createCandidate('annotation-run', candidates.annotationRun),
  ];
  return choices.find((choice): choice is ConversationSurfaceError => choice !== null) ?? null;
}
