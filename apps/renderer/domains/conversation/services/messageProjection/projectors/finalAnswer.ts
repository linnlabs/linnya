import type {
  ExecutionProjectionState,
  MessageProjectionState,
  ProjectionResult,
} from '../state';
import { extractActivityBinding } from '../guards/activityBinding';
import { getMessageById, replaceMessageById, updateMessage } from '../helpers/messageAccess';
import {
  ensureAnswerState,
  ensureTurnState,
  materializeAnswerMessage,
} from '../helpers/turnAnswerState';
import { applyAnswerSegmentChunk } from '../../../features/answer-segment';
import { resolveAnswerSegmentMessageType } from '../../../features/answer-segment';
import { isBlankAnswerContent } from '../../../functions/answerContent';
import { isRecord } from '../../../utils/typeGuards';
import { PROJECTION_DEBUG } from '../debug';
import type { SSEFinalAnswerChunkEvent, SSEFinalAnswerEvent } from '@linnlabs/linnkit/contracts';
import { assertCanonicalFinalAnswerIdentity } from '@linnlabs/linnkit/contracts';
import { conversationMessageIdFromAnswerId } from '@app/schemas';
import { parseConversationAnswerMessageMetadata } from '@app/schemas';
import type { AnswerMessage } from '../../../types';
import { projectMessageCitationDependencies } from '../../../features/citation-presentation';

/**
 * @description
 * 投影 final_answer_chunk / final_answer。
 */

export function projectFinalAnswerChunkEvent(
  state: MessageProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEFinalAnswerChunkEvent
): ProjectionResult {
  const { turn_id: turnId, answer_id: answerId, seq, chunk, is_last } = event;

  if (!turnId || !answerId) {
    return { success: false, reason: 'Missing turn_id or answer_id for final_answer_chunk event' };
  }

  // 校正时间戳：不早于 thought
  const turn = ensureTurnState(executionState, turnId);
  let adjustedTs = event.timestamp;
  if (turn.thoughtMessageId) {
    const thoughtMsg = getMessageById(state, turn.thoughtMessageId);
    if (thoughtMsg && typeof thoughtMsg.timestamp === 'number') {
      adjustedTs = Math.max(adjustedTs, thoughtMsg.timestamp + 1);
    }
  }

  const answer = ensureAnswerState(executionState, answerId, turnId);

  const prevNext = answer.nextSeqToAppend;
  applyAnswerSegmentChunk(answer, seq, chunk);

  // 观测性日志：若出现缺口/乱序导致无法连续 append，及时暴露数据源问题（避免“猜测式兜底”）
  if (PROJECTION_DEBUG && seq > prevNext && answer.nextSeqToAppend === prevNext) {
    console.log(
      `[MessageProjection][final_answer_chunk] 非连续 seq：answer_id=${answerId} turn_id=${turnId} seq=${seq} nextSeqToAppend=${prevNext} chunks.size=${answer.chunks.size}`
    );
  }
  answer.isComplete = Boolean(is_last);

  // 只由不可见字符构成的答案不应落地成消息（否则 UI 会渲染出空白段落，形成难看的空隙）
  if (isBlankAnswerContent(answer.content)) {
    return { success: true, messageId: answer.messageId, newState: state };
  }

  const messageId = materializeAnswerMessage(
    state,
    executionState,
    answer,
    adjustedTs,
    conversationMessageIdFromAnswerId(answerId),
    undefined,
  );

  updateMessage(state, messageId, (message) => {
    if (
      message.type !== 'final_answer'
    ) {
      throw new Error(`Answer ${messageId} received chunks after it was sealed as ${message.type}`);
    }
    const prevMeta = parseConversationAnswerMessageMetadata('final_answer', message.metadata);
    if (prevMeta.completion_reason !== undefined) {
      throw new Error(`Answer ${messageId} received chunks after terminal seal`);
    }
    message.content = answer.content;
    message.timestamp = adjustedTs;
    message.citationDependencies = projectMessageCitationDependencies(
      state.citationWorkspace,
      answer.turnId,
      answer.content,
    );
    message.metadata = parseConversationAnswerMessageMetadata('final_answer', {
      ...prevMeta,
      answer_id: answer.answerId,
      turn_id: answer.turnId,
      run_id: executionState.runId,
      execution_id: executionState.executionId,
      last_seq: seq,
      is_complete: answer.isComplete,
      first_token_at: prevMeta.first_token_at,
    });
  });

  return { success: true, messageId, newState: state };
}

export function projectFinalAnswerEvent(
  state: MessageProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEFinalAnswerEvent,
): ProjectionResult {
  const { turn_id: turnId, answer_id: answerId, content } = event;
  const completionReason = event.completion_reason;
  if (completionReason === undefined) {
    return { success: false, reason: `final_answer ${answerId} is missing completion_reason`, newState: state };
  }

  if (!turnId || !answerId) {
    return { success: false, reason: 'Missing turn_id or answer_id for final_answer event' };
  }

  // 校正时间戳：不早于 thought
  const turn = ensureTurnState(executionState, turnId);
  let adjustedTs = event.timestamp;
  if (turn.thoughtMessageId) {
    const thoughtMsg = getMessageById(state, turn.thoughtMessageId);
    if (thoughtMsg && typeof thoughtMsg.timestamp === 'number') {
      adjustedTs = Math.max(adjustedTs, thoughtMsg.timestamp + 1);
    }
  }

  const activityBinding = extractActivityBinding(event);
  const hasNonEmptyContent = typeof content === 'string' && !isBlankAnswerContent(content);
  const existingAnswer = executionState.answerState.get(answerId);
  if (!existingAnswer) {
    return hasNonEmptyContent
      ? { success: false, reason: `final_answer ${answerId} arrived without a live chunk stream`, newState: state }
      : { success: true, newState: state };
  }
  if (existingAnswer.turnId !== turnId) {
    return {
      success: false,
      reason: `final_answer ${answerId} turn mismatch: ${existingAnswer.turnId} !== ${turnId}`,
      newState: state,
    };
  }
  if (existingAnswer.content !== content) {
    return {
      success: false,
      reason: `final_answer ${answerId} content does not match its live chunk stream`,
      newState: state,
    };
  }

  const answer = existingAnswer;
  answer.isComplete = completionReason !== 'interrupted';

  // 同上：内容仅由不可见字符构成时，不生成 final_answer 消息
  if (isBlankAnswerContent(answer.content)) {
    return { success: true, messageId: answer.messageId, newState: state };
  }

  const messageId = conversationMessageIdFromAnswerId(assertCanonicalFinalAnswerIdentity(event));
  if (answer.messageId !== messageId) {
    return {
      success: false,
      reason: `final_answer ${answerId} live message identity changed: ${answer.messageId} !== ${messageId}`,
      newState: state,
    };
  }

  const liveMessage = getMessageById(state, messageId);
  if (liveMessage?.type !== 'final_answer') {
    return {
      success: false,
      reason: `final_answer ${answerId} points to ${liveMessage?.type ?? 'missing'} instead of live answer`,
      newState: state,
    };
  }
  const previousMetadata = parseConversationAnswerMessageMetadata('final_answer', liveMessage.metadata);
  if (previousMetadata.completion_reason !== undefined) {
    return {
      success: false,
      reason: `final_answer ${answerId} was already sealed`,
      newState: state,
    };
  }
  const type = resolveAnswerSegmentMessageType(completionReason);
  const metadataInput = {
    ...previousMetadata,
    answer_id: answer.answerId,
    turn_id: answer.turnId,
    run_id: executionState.runId,
    execution_id: executionState.executionId,
    is_complete: answer.isComplete,
    completion_reason: completionReason,
    first_token_at: previousMetadata.first_token_at,
    ...(activityBinding ? { activity: activityBinding } : {}),
  };
  const citationDependencies = projectMessageCitationDependencies(
    state.citationWorkspace,
    answer.turnId,
    answer.content,
  );
  let sealedMessage: AnswerMessage;
  switch (type) {
    case 'final_answer':
      sealedMessage = {
        ...liveMessage,
        type,
        content: answer.content,
        timestamp: adjustedTs,
        citationDependencies,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
    case 'tool_preamble':
      sealedMessage = {
        ...liveMessage,
        type,
        content: answer.content,
        timestamp: adjustedTs,
        citationDependencies,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
    case 'partial_answer':
      sealedMessage = {
        ...liveMessage,
        type,
        content: answer.content,
        timestamp: adjustedTs,
        citationDependencies,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
  }
  replaceMessageById(state, messageId, sealedMessage);

  turn.lastMessageType = resolveAnswerSegmentMessageType(completionReason);

  return { success: true, messageId, newState: state };
}
