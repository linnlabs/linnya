import type {
  ExecutionProjectionState,
  MessageProjectionState,
  ProjectionResult,
  RunProjectionState,
} from '../state';
import {
  commitPreparedToolPatch,
  prepareToolPatch,
  type PreparedToolPatch,
  type ToolCallUpsertPatch,
} from '../helpers/toolPatch';
import { getMessageById } from '../helpers/messageAccess';
import { ensureTurnState } from '../helpers/turnAnswerState';
import { isRecord } from '../../../utils/typeGuards';
import { admitCitationsFromConversationToolOutput } from '@linnya/citation-domain/conversation-presentation';
import { projectConversationCitationRegistration } from '../../../features/citation-presentation';
import { PROJECTION_DEBUG } from '../debug';
import { deleteThoughtSegmentBuffer } from '../functions/thoughtSegmentBuffer';
import {
  parseSSEExecutionScope,
  type SSEToolCallDecisionEvent,
  type SSEToolProcessEvent,
  type SSEToolOutputEvent,
} from 'linnkit/contracts';
import { mapRuntimeAttachmentsToConversation } from '../../../functions/runtimeAttachments';
import { conversationMessageIdFromToolIdentity } from '@app/schemas';

type ToolCallLike = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

function isToolCallLike(value: unknown): value is ToolCallLike {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'function') return false;
  if (typeof value['id'] !== 'string' || value['id'].trim().length === 0) return false;
  const fn = value['function'];
  if (!isRecord(fn)) return false;
  if (typeof fn['name'] !== 'string' || fn['name'].trim().length === 0) return false;
  if (typeof fn['arguments'] !== 'string') return false;
  return true;
}

function readToolCallsFromDecisionEvent(
  event: SSEToolCallDecisionEvent,
): ToolCallLike[] {
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const raw = payload?.['tool_calls'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isToolCallLike);
}

function parseToolArgsFromCall(call: ToolCallLike): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// 引用 admission 与来源冲突规则由 Citation domain 公共入口唯一拥有。

/**
 * @description
 * 投影 tool_call_decision / tool_process / tool_output，并将其归并到 tool_calls 消息中。
 */

function buildToolLifecyclePatch(
  event: SSEToolCallDecisionEvent | SSEToolProcessEvent,
): ToolCallUpsertPatch {
  const payloadData: Record<string, unknown> = isRecord(event.payload)
    ? { ...event.payload }
    : {};
  if (event.args !== undefined) {
    payloadData.args = event.args;
  }

  const eventMetadata = isRecord(event.metadata) ? event.metadata : undefined;
  return {
    type: event.type,
    phase: event.phase,
    status: event.status,
    toolName: event.tool_name,
    payload: payloadData,
    eventMetadata,
    messageId: conversationMessageIdFromToolIdentity(
      parseSSEExecutionScope(event).run_id,
      event.tool_call_id,
    ),
    rawEvent: isRecord(event) ? event : {},
  };
}

export function projectToolCallDecisionEvent(
  state: MessageProjectionState,
  runState: RunProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEToolCallDecisionEvent,
): ProjectionResult {
  const { turn_id: turnId, tool_call_id: toolCallId, tool_name: toolName, phase, status } = event;

  if (!turnId || !toolCallId) {
    return { success: false, reason: 'Missing turn_id or tool_call_id for tool_call_decision event' };
  }

  const existingTurn = executionState.turnState.get(turnId);

  if (existingTurn?.answerId) {
    const activeAnswer = executionState.answerState.get(existingTurn.answerId);
    if (activeAnswer && !activeAnswer.isComplete) {
      throw new Error(
        `tool_call_decision arrived before answer ${existingTurn.answerId} was sealed as tool_call`,
      );
    }
  }

  const patches: Array<{ readonly toolCallId: string; readonly patch: ToolCallUpsertPatch }> = [{
    toolCallId,
    patch: buildToolLifecyclePatch(event),
  }];
  const batchedToolCalls = readToolCallsFromDecisionEvent(event);
  if (batchedToolCalls.length > 1) {
    for (const call of batchedToolCalls) {
      if (call.id === toolCallId) continue;
      const perCallArgs = parseToolArgsFromCall(call);
      patches.push({
        toolCallId: call.id,
        patch: {
          type: 'tool_call_decision',
          phase,
          status,
          toolName: call.function.name,
          payload: {
            args: perCallArgs,
            tool_calls: [call],
          },
          eventMetadata: (isRecord(event.metadata) ? { ...event.metadata } : undefined) ?? undefined,
          messageId: conversationMessageIdFromToolIdentity(
            parseSSEExecutionScope(event).run_id,
            call.id,
          ),
          rawEvent: {
            ...event,
            tool_call_id: call.id,
            tool_name: call.function.name,
            args: perCallArgs,
          },
        },
      });
    }
  }

  const preparedPatches: PreparedToolPatch[] = [];
  for (const candidate of patches) {
    const prepared = prepareToolPatch(
      state,
      runState,
      executionState,
      candidate.toolCallId,
      turnId,
      candidate.patch,
      event.timestamp,
    );
    if (prepared) preparedPatches.push(prepared);
  }

  const turn = ensureTurnState(executionState, turnId);
  const committed = preparedPatches.map(prepared => (
    commitPreparedToolPatch(state, runState, prepared)
  ));
  const message = committed[0] ?? null;

  // 终结当前轮次中正在进行的 thought
  if (turn.thoughtMessageId) {
    if (PROJECTION_DEBUG) {
      console.log('[MessageProjection] Tool decision interrupts thought', {
        turnId,
        thoughtMessageId: turn.thoughtMessageId,
        toolCallId,
        toolName,
        phase,
        status,
      });
    }
    const thoughtMessage = getMessageById(state, turn.thoughtMessageId);
    if (thoughtMessage?.type === 'thought' && !thoughtMessage.metadata.is_complete) {
      /**
       * 说明：
       * - “thought 结束”的权威时刻必须由后端基于模型输出边界给出（thought_completed_at），
       *   前端不再用工具事件时间推断，避免把“下一个消息时间”误计入思考时长。
       * - 这里仅清理本地 buffer，避免后续 thought delta 继续拼接到上一段。
       */
    }
    deleteThoughtSegmentBuffer(executionState, turnId, turn.thoughtMessageId);
  } else if (PROJECTION_DEBUG) {
    console.log('[MessageProjection] Tool decision received with no active thought', {
      turnId,
      toolCallId,
      toolName,
      phase,
      status,
    });
  }

  // 终结正在进行的 answer；所有展示 admission 已完成，之后不再有可失败的 payload 解释。
  if (turn.answerId) {
    executionState.answerState.delete(turn.answerId);
    turn.answerId = undefined;
    turn.answerMessageId = undefined;
  }

  /**
   * ✅ Replay 根因修复：为 batched tool_call_decision 中的“次级 tool_call”提前建立 UI 锚点
   *
   * 背景：
   * - 执行层为了保持 transcript 合法性，只会持久化一条 tool_call_decision，
   *   其中 payload.tool_calls 可能包含多个 tool_call；
   * - 实时阶段，后续每个 tool_call 还会收到各自的 tool_process，因此 UI 仍能为它们补建 message/toolState；
   * - 但 replay 不持久化 tool_process，导致除 primary 之外的 tool_call 在历史里失去锚点：
   *   - subrun_trace 无法通过 parent_tool_call_id 挂载；
   *   - tool_output 只能“裸创建”消息，因缺失 args.description 而退化为“（未命名）”。
   *
   * 结论：
   * - 在投影这条 batched decision 时，显式为每个 secondary tool_call 创建独立的 UI message/toolState；
   * - 这不会改变持久化事实协议，只是让 replay 与 live 在 UI 投影层语义一致。
   */
  turn.lastMessageType = 'tool_call_decision';

  return { success: !!message, messageId: message?.id, newState: state };
}

export function projectToolProcessEvent(
  state: MessageProjectionState,
  runState: RunProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEToolProcessEvent,
): ProjectionResult {
  const { turn_id: turnId, tool_call_id: toolCallId } = event;

  if (!turnId || !toolCallId) {
    return { success: false, reason: 'Missing turn_id or tool_call_id for tool_process event' };
  }

  const patch = buildToolLifecyclePatch(event);
  const prepared = prepareToolPatch(
    state,
    runState,
    executionState,
    toolCallId,
    turnId,
    patch,
    event.timestamp,
  );
  if (!prepared) return { success: false, reason: 'Invalid tool_process identity' };
  const turn = ensureTurnState(executionState, turnId);
  const message = commitPreparedToolPatch(state, runState, prepared);
  turn.lastMessageType = 'tool_process';
  return { success: !!message, messageId: message?.id, newState: state };
}

export function projectToolOutputEvent(
  state: MessageProjectionState,
  runState: RunProjectionState,
  executionState: ExecutionProjectionState,
  event: SSEToolOutputEvent,
): ProjectionResult {
  const { turn_id: turnId, tool_call_id: toolCallId, tool_name: toolName, status } = event;

  if (!turnId || !toolCallId) {
    return { success: false, reason: 'Missing turn_id or tool_call_id for tool_output event' };
  }

  const effectiveStatus: 'loading' | 'success' | 'error' = status;
  const resultPresentation = isRecord(event.metadata?.presentation)
    ? event.metadata.presentation
    : undefined;
  const structuredResult = status === 'success'
    ? {
        data: event.data,
        observation: event.observation,
        ...(resultPresentation ?? {}),
      }
    : {
        error: event.error,
        observation: event.observation,
      };

  const patch: ToolCallUpsertPatch = {
    type: 'tool_output',
    phase: effectiveStatus === 'error' ? 'error' : 'complete',
    status: effectiveStatus,
    toolName,
    observation: event.observation,
    data: event.data,
    error: event.error,
    errorCode: event.error_code,
    presentation: resultPresentation,
    eventMetadata: (isRecord(event.metadata) ? event.metadata : undefined) ?? undefined,
    messageId: conversationMessageIdFromToolIdentity(
      parseSSEExecutionScope(event).run_id,
      toolCallId,
    ),
    rawEvent: event,
  };

  const prepared = prepareToolPatch(
    state,
    runState,
    executionState,
    toolCallId,
    turnId,
    patch,
    event.timestamp,
  );
  if (!prepared) return { success: false, reason: 'Invalid tool_output identity' };
  const attachments = mapRuntimeAttachmentsToConversation(event.attachments);
  const preparedWithAttachments: PreparedToolPatch = attachments
    ? {
        ...prepared,
        message: { ...prepared.message, attachments },
      }
    : prepared;
  const citationAdmission = typeof toolName === 'string'
    ? admitCitationsFromConversationToolOutput({ toolName, status, result: structuredResult })
    : null;
  const nextCitationWorkspace = citationAdmission
    ? projectConversationCitationRegistration(
        state.citationWorkspace,
        turnId,
        citationAdmission.citations,
      )
    : state.citationWorkspace;
  const turn = ensureTurnState(executionState, turnId);
  const message = commitPreparedToolPatch(state, runState, preparedWithAttachments);
  state.citationWorkspace = nextCitationWorkspace;

  turn.lastMessageType = 'tool_output';

  return { success: !!message, messageId: message?.id, newState: state };
}
