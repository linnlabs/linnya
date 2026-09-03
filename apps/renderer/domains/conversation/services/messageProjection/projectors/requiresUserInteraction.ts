import type {
  ExecutionProjectionState,
  MessageProjectionState,
  ProjectionResult,
  RunProjectionState,
} from '../state';
import {
  parseSSEExecutionScope,
  type SSERequiresUserInteractionEvent,
} from 'linnkit/contracts';
import { getMessageById } from '../helpers/messageAccess';
import { isRecord } from '../../../utils/typeGuards';
import { commitPreparedToolPatch, prepareToolPatch } from '../helpers/toolPatch';
import { conversationMessageIdFromToolIdentity } from '@app/schemas';

/**
 * @description
 * `requires_user_interaction` 是控制面事件：
 * - 它的权威职责是告诉前端“后端已经正式进入 wait_user”；
 * - 投影层不在这里创建消息，只把事件视为成功消费，避免请求级 dispatcher 把它当成未知事件。
 */
export function projectRequiresUserInteractionEvent(
  state: MessageProjectionState,
  runState: RunProjectionState,
  executionState: ExecutionProjectionState,
  event: SSERequiresUserInteractionEvent,
): ProjectionResult {
  const toolState = runState.toolState.get(event.tool_call_id);
  if (!toolState) {
    return {
      success: false,
      reason: `requires_user_interaction parent tool not found: ${event.tool_call_id}`,
      newState: state,
    };
  }
  const message = getMessageById(state, toolState.messageId);
  if (!message) {
    return {
      success: false,
      reason: `requires_user_interaction tool message not found: ${toolState.messageId}`,
      newState: state,
    };
  }
  if (message.type !== 'tool_calls') {
    throw new Error(`Interaction parent ${message.id} is ${message.type}, expected tool_calls`);
  }

  if (!isRecord(event.form) || event.form.data === undefined
    || typeof event.form.observation !== 'string' || !event.form.observation.trim()) {
    throw new Error(`Interaction ${event.interaction_id} 缺少 canonical form data/observation`);
  }
  const prepared = prepareToolPatch(
    state,
    runState,
    executionState,
    event.tool_call_id,
    event.turn_id,
    {
      type: 'tool_output',
      phase: 'update',
      status: 'loading',
      toolName: message.metadata.tool_name,
      observation: event.form.observation,
      data: event.form.data,
      eventMetadata: {
        interaction: {
          status: 'active',
          interactionId: event.interaction_id,
          runId: event.run_id,
          checkpointRevision: event.checkpoint_revision,
          resumeToken: event.resume_token,
        },
      },
      messageId: conversationMessageIdFromToolIdentity(
        parseSSEExecutionScope(event).run_id,
        event.tool_call_id,
      ),
      rawEvent: event,
    },
    event.timestamp,
  );
  if (!prepared) {
    return { success: false, reason: 'Invalid interaction tool identity', newState: state };
  }
  commitPreparedToolPatch(state, runState, prepared);

  return { success: true, messageId: message.id, newState: state };
}
