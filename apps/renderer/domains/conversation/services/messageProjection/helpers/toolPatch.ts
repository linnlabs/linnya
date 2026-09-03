import type {
  ExecutionProjectionState,
  MessageProjectionState,
  RunProjectionState,
} from '../state';
import { extractActivityBinding } from '../guards/activityBinding';
import { appendMessage, getMessageById, replaceMessageById } from './messageAccess';
import { ConversationMessageIdSchema } from '@app/schemas';
import type { ToolCallMessage } from '../../../types';
import {
  prepareToolCallMessageCandidate,
  type ToolCallUpsertPatch as CandidateToolCallUpsertPatch,
} from './prepareToolCallMessageCandidate';

/**
 * @description
 * 工具调用更新补丁（tool_call_decision / tool_process / tool_output）与归并逻辑。
 *
 * 说明：
 * - tool_calls 消息是“归并载体”：决策事件、过程事件、tool_output 都会 patch 到同一条 tool_calls；
 * - ToolMessageService 负责 metadata/content 的生成与 patch；
 * - 这里负责把 patch 应用到 projection state，并维护 toolState 索引。
 */

export interface ToolCallUpsertPatch extends CandidateToolCallUpsertPatch {
  /**
   * 创建工具消息时使用的正式 Conversation 身份。它必须由 `run_id + tool_call_id`
   * 通过产品合同派生，禁止使用当前 event id，否则 live 与 replay 会因首个事件不同
   * 而为同一工具生成两条消息。
   */
  messageId: string;
}

export interface PreparedToolPatch {
  readonly toolCallId: string;
  readonly turnId: string;
  readonly existingMessageId: string | null;
  readonly message: ToolCallMessage;
}

/** 纯 prepare：完成 schema/projector admission，但不修改 message、索引或 toolState。 */
export function prepareToolPatch(
  state: MessageProjectionState,
  runState: RunProjectionState,
  executionState: ExecutionProjectionState,
  toolCallId: string | undefined,
  turnId: string,
  patch: ToolCallUpsertPatch,
  timestamp: number
): PreparedToolPatch | null {
  if (!toolCallId || !turnId) {
    return null;
  }

  const tool = runState.toolState.get(toolCallId);
  if (tool && tool.turnId !== turnId) {
    throw new Error(
      `Tool call ${toolCallId} changed turn ownership in run ${runState.runId}: ${tool.turnId} !== ${turnId}`,
    );
  }

  const currentMessage = tool ? getMessageById(state, tool.messageId) : null;
  if (tool && !currentMessage) {
    throw new Error(
      `Tool projection state points to missing message ${tool.messageId}: ${toolCallId}`,
    );
  }
  if (currentMessage && currentMessage.type !== 'tool_calls') {
    throw new Error(`Tool projection identity points to ${currentMessage.type}: ${tool?.messageId}`);
  }
  if (!tool && state.messageIndex.has(patch.messageId)) {
    throw new Error(
      `Tool projection message identity is already owned by another message: ${patch.messageId}`,
    );
  }

  /**
   * 必须在任何 tool message/toolState 变异前完成。projector 抛错时，reduceEvent 虽会捕获，
   * 但 mutable projection 不提供回滚；先投影再提交才能避免留下半更新 runtime。
   */
  const activityBinding = extractActivityBinding(patch.rawEvent);
  const message = prepareToolCallMessageCandidate({
    previousMessage: currentMessage,
    identity: {
      messageId: ConversationMessageIdSchema.parse(patch.messageId),
      toolCallId,
      turnId,
      runId: executionState.runId,
      executionId: executionState.executionId,
      ...(activityBinding ? { activity: activityBinding } : {}),
    },
    patch,
    timestamp,
  });
  return {
    toolCallId,
    turnId,
    existingMessageId: tool?.messageId ?? null,
    message,
  };
}

/** commit 不再解释 payload；同一个 event 的全部 prepare 成功后才能调用。 */
export function commitPreparedToolPatch(
  state: MessageProjectionState,
  runState: RunProjectionState,
  prepared: PreparedToolPatch,
): ToolCallMessage {
  if (prepared.existingMessageId === null) {
    appendMessage(state, prepared.message);
    runState.toolState.set(prepared.toolCallId, {
      toolCallId: prepared.toolCallId,
      turnId: prepared.turnId,
      messageId: prepared.message.id,
    });
    return prepared.message;
  }

  const replaced = replaceMessageById(
    state,
    prepared.existingMessageId,
    prepared.message,
  );
  if (!replaced) {
    throw new Error(
      `Prepared tool message disappeared before commit: ${prepared.existingMessageId}`,
    );
  }
  return prepared.message;
}
