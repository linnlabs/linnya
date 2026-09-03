import type { BaseMessage } from '../../../types';

function readMessageRunId(message: BaseMessage): string | null {
  switch (message.type) {
    case 'user_input':
      return message.metadata?.run_id ?? message.metadata?.activity?.runId ?? null;
    case 'thought':
    case 'tool_calls':
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return message.metadata.run_id;
    case 'history_summary':
    case 'summarization_progress':
      return message.metadata.run_id;
  }
}

/** 一行只有携带当前 active run 的正式归属身份时，才进入 streaming 生命周期。 */
export function isVisualTurnOwnedByActiveRun(
  turnMessages: readonly BaseMessage[],
  activeRunIds: readonly string[],
): boolean {
  if (activeRunIds.length === 0) return false;
  const active = new Set(activeRunIds);
  return turnMessages.some(message => {
    const runId = readMessageRunId(message);
    return runId !== null && active.has(runId);
  });
}

/** Markdown streaming 只属于明确未完成的 answer segment，不再继承整个 turn 的忙碌状态。 */
export function isAnswerSegmentStreaming(
  message: BaseMessage,
  isTurnStreaming: boolean,
): boolean {
  if (!isTurnStreaming) return false;
  if (
    message.type !== 'final_answer'
    && message.type !== 'tool_preamble'
    && message.type !== 'partial_answer'
  ) {
    return false;
  }
  return message.metadata.is_complete === false;
}
