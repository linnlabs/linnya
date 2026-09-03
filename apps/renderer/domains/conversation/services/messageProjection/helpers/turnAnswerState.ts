import type { BaseMessage, ActivityBinding } from '../../../types';
import type {
  AnswerState,
  ExecutionProjectionState,
  MessageProjectionState,
  TurnState,
} from '../state';
import { appendMessage } from './messageAccess';
import { createAnswerSegmentState } from '../../../features/answer-segment';
import { ConversationUnsealedAnswerMessageMetadataSchema } from '@app/schemas';

/**
 * @description
 * Turn/Answer 索引维护（高内聚 helpers）。
 */

export function ensureTurnState(
  executionState: ExecutionProjectionState,
  turnId: string,
): TurnState {
  if (!turnId) {
    throw new Error('turnId cannot be empty');
  }

  let turnState = executionState.turnState.get(turnId);
  if (!turnState) {
    turnState = { turnId };
    executionState.turnState.set(turnId, turnState);
  }
  return turnState;
}

export function ensureAnswerState(
  executionState: ExecutionProjectionState,
  answerId: string,
  turnId: string,
): AnswerState {
  if (!answerId || !turnId) {
    throw new Error('answerId and turnId cannot be empty');
  }

  let answerState = executionState.answerState.get(answerId);
  if (!answerState) {
    answerState = {
      ...createAnswerSegmentState(answerId),
      turnId,
    };
    executionState.answerState.set(answerId, answerState);
  } else if (answerState.turnId !== turnId) {
    throw new Error(
      `Answer ${answerId} changed turn ownership in execution ${executionState.executionId}: ${answerState.turnId} !== ${turnId}`,
    );
  }

  const turn = ensureTurnState(executionState, turnId);
  turn.answerId = answerId;
  return answerState;
}

export function materializeAnswerMessage(
  state: MessageProjectionState,
  executionState: ExecutionProjectionState,
  answer: AnswerState,
  timestamp: number,
  messageId: string,
  activityBinding?: ActivityBinding
): string {
  if (answer.messageId) {
    return answer.messageId;
  }

  const message: BaseMessage = {
    id: messageId,
    role: 'assistant',
    type: 'final_answer',
    content: answer.content,
    timestamp,
    metadata: ConversationUnsealedAnswerMessageMetadataSchema.parse({
      answer_id: answer.answerId,
      turn_id: answer.turnId,
      run_id: executionState.runId,
      execution_id: executionState.executionId,
      is_complete: answer.isComplete,
      first_token_at: timestamp,
      ...(activityBinding ? { activity: activityBinding } : {}),
    }),
  };
  appendMessage(state, message);

  answer.messageId = messageId;
  const turn = ensureTurnState(executionState, answer.turnId);
  turn.answerId = answer.answerId;
  turn.answerMessageId = messageId;
  return messageId;
}
