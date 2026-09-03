import type {
  ExecutionProjectionState,
  MessageProjectionState,
  ProjectionResult,
} from '../state';
import { removeMessageById } from '../helpers/messageAccess';
import { deleteThoughtSegmentBuffer } from '../functions/thoughtSegmentBuffer';
import type { SSEFinalAnswerResetEvent } from 'linnkit/contracts';

/**
 * @description
 * 投影 final_answer_reset：丢弃失败 LLM attempt 已下发的在途答案与思考。
 */
export function projectFinalAnswerResetEvent(
  state: MessageProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEFinalAnswerResetEvent,
): ProjectionResult {
  const { turn_id: turnId, answer_id: answerId, thought_message_ids: thoughtMessageIds } = event;

  if (answerId) {
    const answerState = executionState.answerState.get(answerId);
    if (answerState?.messageId) {
      removeMessageById(state, answerState.messageId);
    }
    executionState.answerState.delete(answerId);

    if (turnId) {
      const turn = executionState.turnState.get(turnId);
      if (turn && turn.answerId === answerId) {
        turn.answerId = undefined;
        turn.answerMessageId = undefined;
      }
    }
  }

  if (Array.isArray(thoughtMessageIds) && thoughtMessageIds.length > 0) {
    const thoughtIdSet = new Set(thoughtMessageIds);
    for (const thoughtMessageId of thoughtIdSet) {
      removeMessageById(state, thoughtMessageId);
    }

    for (const [currentTurnId, turn] of executionState.turnState.entries()) {
      if (turn.thoughtMessageId && thoughtIdSet.has(turn.thoughtMessageId)) {
        deleteThoughtSegmentBuffer(executionState, currentTurnId, turn.thoughtMessageId);
        turn.thoughtMessageId = undefined;
        if (turn.lastMessageType === 'thought') {
          turn.lastMessageType = undefined;
        }
      }
    }
  }

  return { success: true, newState: state };
}
