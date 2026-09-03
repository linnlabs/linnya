import type { BaseMessage } from '../../../types';
import type {
  ExecutionProjectionState,
  MessageProjectionState,
  ProjectionResult,
} from '../state';
import { extractActivityBinding } from '../guards/activityBinding';
import { appendMessage, getMessageById, updateMessage } from '../helpers/messageAccess';
import { ensureTurnState } from '../helpers/turnAnswerState';
import { PROJECTION_DEBUG } from '../debug';
import type { SSEThoughtEvent } from '@linnlabs/linnkit/contracts';
import { ConversationThoughtMessageMetadataSchema } from '@app/schemas';
import {
  deleteThoughtSegmentBuffer,
  readThoughtSegmentBuffer,
  writeThoughtSegmentBuffer,
} from '../functions/thoughtSegmentBuffer';
import { projectMessageCitationDependencies } from '../../../features/citation-presentation';

/**
 * @description
 * 投影思考事件（thought delta / complete）。
 *
 * 注意：
 * - 保留原始实现的去重策略、thought_message_id 归并策略与日志；
 * - 将 activity meta 注入 message.metadata.activity，用于稳定记录运行归属。
 */
export function projectThoughtEvent(
  state: MessageProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEThoughtEvent,
): ProjectionResult {
  const turnId = event.turn_id;
  if (!turnId) {
    return { success: false, reason: 'Missing turn_id for thought event' };
  }

  const turn = ensureTurnState(executionState, turnId);

  const isComplete = !!event.is_complete;
  const incomingThoughtMessageId =
    typeof event.thought_message_id === 'string' && event.thought_message_id.length > 0
      ? event.thought_message_id
      : undefined;
  const incomingMessageIdentity = incomingThoughtMessageId ?? event.id;

  const toShortHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };

  if (PROJECTION_DEBUG && isComplete) {
    const content = typeof event.content === 'string' ? event.content : '';
    console.log('[MessageProjection] Thought complete:', {
      eventId: event.id,
      incomingThoughtMessageId,
      turnId,
      lastMsgType: turn.lastMessageType,
      currentThoughtId: turn.thoughtMessageId,
      contentLen: content.length,
      contentHash: content ? toShortHash(content) : '',
      isComplete,
    });
  }

  // thought_message_id 是段身份；连续 Thought 也必须在身份变化时立即切段。
  if (turn.thoughtMessageId !== incomingMessageIdentity) {
    if (PROJECTION_DEBUG) {
      console.log('[MessageProjection] Thought segment identity changed', {
        eventId: event.id,
        previousThoughtMessageId: turn.thoughtMessageId,
        incomingThoughtMessageId: incomingMessageIdentity,
        turnId,
      });
    }
  }

  const messageId = incomingMessageIdentity;
  const prevContent = readThoughtSegmentBuffer(executionState, turnId, messageId);
  const existingMessage = getMessageById(state, messageId);
  if (existingMessage && existingMessage.type !== 'thought') {
    return {
      success: false,
      reason: `Thought projection identity points to ${existingMessage.type}: ${messageId}`,
    };
  }
  if (existingMessage?.metadata.is_complete === true && !isComplete) {
    return {
      success: false,
      reason: `Completed thought segment cannot return to streaming: ${messageId}`,
    };
  }

  // 去重策略
  if (existingMessage) {
    /**
     * 说明：
     * - 增量 thought（is_complete=false）允许基于内容做去重，避免重复渲染
     * - 但 complete thought（is_complete=true）必须落一次“完成态元数据”（thought_completed_at/is_complete）
     *   即使 content 与 prevContent 完全相同也不能 return，否则 UI 永远看不到完成态/思考时长。
     */
    if (!isComplete) {
      if (typeof event.content === 'string' && event.content === prevContent) {
        turn.thoughtMessageId = messageId;
        return { success: true, messageId, newState: state };
      }
      if (typeof event.delta === 'string' && event.delta.length > 0 && prevContent.endsWith(event.delta)) {
        turn.thoughtMessageId = messageId;
        return { success: true, messageId, newState: state };
      }
    } else {
      // complete 事件：schema 已保证完成态必有 completed_at，可直接幂等跳过
      const existingMeta = existingMessage.metadata;
      if (existingMeta?.is_complete === true) {
        // 仍然要清理 buffer，避免后续误拼接
        deleteThoughtSegmentBuffer(executionState, turnId, messageId);
        turn.thoughtMessageId = messageId;
        return { success: true, messageId, newState: state };
      }
    }
  }

  const nextContent = event.content ?? (prevContent + (event.delta ?? ''));
  if (!existingMessage && nextContent.trim().length === 0) {
    if (event.is_complete) {
      deleteThoughtSegmentBuffer(executionState, turnId, messageId);
    }
    return { success: true, newState: state };
  }
  // BaseSSEEvent.id 是 wire 必填身份；thought_message_id 仅用于跨 delta 归并。
  const activityBinding = extractActivityBinding(event);
  const effectiveActivityBinding = activityBinding;
  const eventMeta = event.metadata;
  const startedAtFromEvent =
    typeof eventMeta?.thought_started_at === 'number' ? eventMeta.thought_started_at : event.timestamp;
  const completedAtFromEvent =
    typeof eventMeta?.thought_completed_at === 'number' ? eventMeta.thought_completed_at : event.timestamp;

  if (!existingMessage) {
    const message: BaseMessage = {
      id: messageId,
      role: 'assistant',
      type: 'thought',
      content: nextContent,
      timestamp: event.timestamp,
      citationDependencies: projectMessageCitationDependencies(
        state.citationWorkspace,
        turnId,
        nextContent,
      ),
      metadata: ConversationThoughtMessageMetadataSchema.parse({
        turn_id: turnId,
        run_id: executionState.runId,
        execution_id: executionState.executionId,
        is_complete: !!event.is_complete,
        /**
         * 说明：
         * - thought_started_at / thought_completed_at 由后端在“真实思考边界”处写入（权威锚点）
         * - 前端只做透传与展示，禁止用后续消息时间推断
         */
        thought_started_at: startedAtFromEvent,
        ...(event.is_complete ? { thought_completed_at: completedAtFromEvent } : {}),
        ...(effectiveActivityBinding ? { activity: effectiveActivityBinding } : {}),
      }),
    };
    appendMessage(state, message);
  } else {
    const prevMeta = ConversationThoughtMessageMetadataSchema.parse(existingMessage.metadata);
    const startedAt = prevMeta.thought_started_at;
    const commonMetadata = {
      turn_id: turnId,
      run_id: executionState.runId,
      execution_id: executionState.executionId,
      thought_started_at: startedAt,
      ...(prevMeta.activity
        ? { activity: prevMeta.activity }
        : effectiveActivityBinding
          ? { activity: effectiveActivityBinding }
          : {}),
    };
    const nextMetadata = ConversationThoughtMessageMetadataSchema.parse(
      event.is_complete
        ? {
            ...commonMetadata,
            is_complete: true,
            thought_completed_at: completedAtFromEvent,
          }
        : {
            ...commonMetadata,
            is_complete: false,
          },
    );
    updateMessage(state, messageId, (message) => {
      if (message.type !== 'thought') {
        throw new Error(`Thought projection identity points to ${message.type}: ${messageId}`);
      }
      message.content = nextContent;
      message.timestamp = event.timestamp;
      message.citationDependencies = projectMessageCitationDependencies(
        state.citationWorkspace,
        turnId,
        nextContent,
      );
      message.metadata = nextMetadata;
    });
  }

  turn.thoughtMessageId = messageId;
  turn.lastMessageType = 'thought';

  if (event.is_complete) {
    deleteThoughtSegmentBuffer(executionState, turnId, messageId);
  } else {
    writeThoughtSegmentBuffer(executionState, turnId, messageId, nextContent);
  }

  return { success: true, messageId, newState: state };
}
