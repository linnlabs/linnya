import type { SSESubRunTraceEvent } from 'linnkit/contracts';

import {
  conversationSubrunMessageIdFromSummaryIdentity,
  conversationSubrunMessageIdFromToolIdentity,
  ConversationThoughtMessageMetadataSchema,
  parseConversationAnswerMessageMetadata,
  type ConversationAttachmentRef,
} from '@app/schemas';
import type {
  ActivityBinding,
  AnswerMessage,
  BaseMessage,
  ToolCallMessage,
} from '../../../types';
import {
  prepareToolCallMessageCandidate,
  type ToolCallUpsertPatch,
} from '../../../services/messageProjection/helpers/prepareToolCallMessageCandidate';
import { isBlankAnswerContent } from '../../../functions/answerContent';
import { mapRuntimeAttachmentsToConversation } from '../../../functions/runtimeAttachments';
import {
  applyAnswerSegmentChunk,
  createAnswerSegmentState,
  resolveAnswerSegmentMessageType,
} from '../../answer-segment';
import type {
  SubrunAnswerProjectionState,
  SubrunMessageProjectionState,
  SubrunStepStatus,
  SubrunTraceProjectionResult,
} from '../definitions/subrunCard';
import { admitCitationsFromConversationSubrunOutput } from '@linnya/citation-domain/conversation-presentation';
import {
  createConversationCitationProjectionWorkspace,
  projectConversationCitationRegistration,
  projectMessageCitationDependencies,
} from '../../citation-presentation';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildSubrunActivityBinding(runId: string): ActivityBinding {
  return { runId, feature: 'subagent_general' };
}

export function createSubrunMessageProjectionState(): SubrunMessageProjectionState {
  return {
    citationWorkspace: createConversationCitationProjectionWorkspace(),
    toolMessageIndexByCallId: new Map(),
    toolDecisionByCallId: new Map(),
    currentThoughtMessageIndex: undefined,
    thoughtSequence: 0,
    answerStateById: new Map(),
    subrunId: '',
    currentThoughtStartedAt: undefined,
  };
}

export function resetSubrunMessageProjection(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  subrunId: string,
): void {
  state.toolMessageIndexByCallId.clear();
  state.toolDecisionByCallId.clear();
  state.currentThoughtMessageIndex = undefined;
  state.thoughtSequence = 0;
  state.answerStateById.clear();
  state.citationWorkspace = createConversationCitationProjectionWorkspace();
  state.subrunId = subrunId;
  state.currentThoughtStartedAt = undefined;
  messages.splice(0, messages.length);
}

function normalizeToolStatus(value: unknown): SubrunStepStatus | undefined {
  return value === 'success' || value === 'error' || value === 'loading' ? value : undefined;
}

function commitToolMessage(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  params: {
    readonly toolCallId: string;
    readonly patch: ToolCallUpsertPatch;
    readonly attachments?: readonly ConversationAttachmentRef[];
    readonly timestamp: number;
    readonly turnId: string;
  },
): void {
  const existingIndex = state.toolMessageIndexByCallId.get(params.toolCallId);
  let previousMessage: ToolCallMessage | null = null;
  if (existingIndex !== undefined) {
    const indexedMessage = messages[existingIndex];
    if (!indexedMessage) {
      throw new Error(`Subrun tool index is out of bounds: ${params.toolCallId}`);
    }
    if (indexedMessage.type !== 'tool_calls') {
      throw new Error(`Subrun tool index points to ${indexedMessage.type}: ${params.toolCallId}`);
    }
    previousMessage = indexedMessage;
  }
  const candidate = prepareToolCallMessageCandidate({
    previousMessage,
    identity: {
      messageId: conversationSubrunMessageIdFromToolIdentity(state.subrunId, params.toolCallId),
      toolCallId: params.toolCallId,
      turnId: params.turnId,
      runId: state.subrunId,
      activity: buildSubrunActivityBinding(state.subrunId),
    },
    patch: params.patch,
    timestamp: params.timestamp,
  });
  const candidateWithAttachments = params.attachments
    ? { ...candidate, attachments: params.attachments }
    : candidate;
  if (existingIndex === undefined) {
    messages.push(candidateWithAttachments);
    state.toolMessageIndexByCallId.set(params.toolCallId, messages.length - 1);
  } else {
    messages[existingIndex] = candidateWithAttachments;
  }
}

function createProcessPatch(
  toolName: string,
  status: SubrunStepStatus,
  args: Readonly<Record<string, unknown>>,
): ToolCallUpsertPatch {
  return {
    type: 'tool_process',
    toolName,
    status,
    phase: 'start',
    payload: { args: { ...args } },
  };
}

function createOutputPatch(params: {
  readonly toolName: string;
  readonly status: SubrunStepStatus;
  readonly output: unknown;
}): ToolCallUpsertPatch {
  if (!isRecord(params.output)) {
    throw new Error(`Subrun tool_output ${params.toolName} 缺少结构化结果`);
  }
  const observation = typeof params.output.observation === 'string'
    ? params.output.observation
    : undefined;
  const presentation = Array.isArray(params.output.media)
    ? { media: params.output.media }
    : undefined;
  return {
    type: 'tool_output',
    toolName: params.toolName,
    status: params.status,
    phase: params.status === 'error' ? 'error' : 'complete',
    observation,
    data: params.output.data,
    error: typeof params.output.error === 'string' ? params.output.error : undefined,
    presentation,
  };
}

function applyToolOutput(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  params: {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly status: SubrunStepStatus;
    readonly output: unknown;
    readonly attachments?: readonly ConversationAttachmentRef[];
    readonly timestamp: number;
    readonly turnId: string;
  },
): void {
  const existingIndex = state.toolMessageIndexByCallId.get(params.toolCallId);
  if (existingIndex === undefined) {
    const decision = state.toolDecisionByCallId.get(params.toolCallId);
    if (!decision) {
      throw new Error(`Subrun tool_output ${params.toolCallId} 缺少 durable decision`);
    }
    if (decision.toolName !== params.toolName || decision.turnId !== params.turnId) {
      throw new Error(`Subrun tool_output ${params.toolCallId} 与 durable decision 身份冲突`);
    }
    commitToolMessage(state, messages, {
      toolCallId: params.toolCallId,
      patch: createProcessPatch(params.toolName, 'loading', decision.args),
      timestamp: decision.timestamp,
      turnId: decision.turnId,
    });
  }
  const citationAdmission = admitCitationsFromConversationSubrunOutput({
    toolName: params.toolName,
    status: params.status,
    output: params.output,
  });
  const nextCitationWorkspace = citationAdmission
    ? projectConversationCitationRegistration(
        state.citationWorkspace,
        params.turnId,
        citationAdmission.citations,
      )
    : state.citationWorkspace;
  commitToolMessage(state, messages, {
    toolCallId: params.toolCallId,
    patch: createOutputPatch(params),
    attachments: params.attachments,
    timestamp: params.timestamp,
    turnId: params.turnId,
  });
  state.citationWorkspace = nextCitationWorkspace;
}

function isCompletedThought(message: BaseMessage): boolean {
  if (message.type !== 'thought') return false;
  return message.metadata.is_complete;
}

function upsertThought(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  params: {
    readonly delta?: string;
    readonly content?: string;
    readonly isComplete: boolean;
    readonly timestamp: number;
    readonly turnId: string;
  },
): void {
  const nextText = params.delta && params.delta.length > 0 ? params.delta : (params.content ?? '');
  if (nextText.length === 0 && !params.isComplete) return;

  const currentIndex = state.currentThoughtMessageIndex;
  const currentMessage = currentIndex === undefined ? undefined : messages[currentIndex];
  if (!currentMessage || isCompletedThought(currentMessage)) {
    state.thoughtSequence += 1;
    state.currentThoughtStartedAt = params.timestamp;
    messages.push({
      id: `subrun_${state.subrunId}_thought_${state.thoughtSequence}`,
      role: 'assistant',
      type: 'thought',
      content: params.isComplete ? (params.content ?? nextText) : nextText,
      timestamp: params.timestamp,
      citationDependencies: projectMessageCitationDependencies(
        state.citationWorkspace,
        params.turnId,
        params.isComplete ? (params.content ?? nextText) : nextText,
      ),
      metadata: ConversationThoughtMessageMetadataSchema.parse({
        turn_id: params.turnId,
        run_id: state.subrunId,
        is_complete: params.isComplete,
        thought_started_at: params.timestamp,
        ...(params.isComplete ? { thought_completed_at: params.timestamp } : {}),
        activity: buildSubrunActivityBinding(state.subrunId),
      }),
    });
    state.currentThoughtMessageIndex = params.isComplete ? undefined : messages.length - 1;
    if (params.isComplete) state.currentThoughtStartedAt = undefined;
    return;
  }

  currentMessage.content = params.isComplete
    ? (params.content ?? currentMessage.content)
    : `${currentMessage.content}${nextText}`;
  currentMessage.timestamp = params.timestamp;
  currentMessage.citationDependencies = projectMessageCitationDependencies(
    state.citationWorkspace,
    params.turnId,
    currentMessage.content,
  );
  if (currentMessage.type !== 'thought') {
    throw new Error(`Subrun thought index points to ${currentMessage.type}`);
  }
  currentMessage.metadata = ConversationThoughtMessageMetadataSchema.parse({
    ...currentMessage.metadata,
    turn_id: params.turnId,
    run_id: state.subrunId,
    is_complete: params.isComplete,
    thought_started_at: currentMessage.metadata.thought_started_at,
    ...(params.isComplete ? { thought_completed_at: params.timestamp } : {}),
  });
  if (params.isComplete) {
    state.currentThoughtMessageIndex = undefined;
    state.currentThoughtStartedAt = undefined;
  }
}

function ensureSubrunAnswerState(
  state: SubrunMessageProjectionState,
  answerId: string,
  turnId: string,
): SubrunAnswerProjectionState | null {
  const existing = state.answerStateById.get(answerId);
  if (existing) {
    return existing.turnId === turnId ? existing : null;
  }
  const answer: SubrunAnswerProjectionState = {
    ...createAnswerSegmentState(answerId),
    turnId,
    messageIndex: undefined,
  };
  state.answerStateById.set(answerId, answer);
  return answer;
}

function updateSubrunAnswerMessage(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  answer: SubrunAnswerProjectionState,
  params: {
    readonly timestamp: number;
    readonly lastSeq?: number;
    readonly sealSourceEventId?: string;
    readonly completionReason?: NonNullable<SSESubRunTraceEvent['completion_reason']>;
  },
): void {
  if (isBlankAnswerContent(answer.content)) return;
  const index = answer.messageIndex;
  if (index === undefined) {
    if (params.completionReason !== undefined) {
      throw new Error(`Subrun answer ${answer.answerId} was sealed before its live message existed`);
    }
    messages.push({
      id: `subrun_${state.subrunId}_answer_${answer.answerId}`,
      role: 'assistant',
      type: 'final_answer',
      content: answer.content,
      timestamp: params.timestamp,
      citationDependencies: projectMessageCitationDependencies(
        state.citationWorkspace,
        answer.turnId,
        answer.content,
      ),
      metadata: parseConversationAnswerMessageMetadata('final_answer', {
        answer_id: answer.answerId,
        turn_id: answer.turnId,
        run_id: state.subrunId,
        is_complete: answer.isComplete,
        first_token_at: params.timestamp,
        ...(params.lastSeq === undefined ? {} : { last_seq: params.lastSeq }),
        activity: buildSubrunActivityBinding(state.subrunId),
      }),
    });
    answer.messageIndex = messages.length - 1;
    return;
  }

  const message = messages[index];
  if (!message) return;
  if (
    message.type !== 'final_answer'
    && message.type !== 'tool_preamble'
    && message.type !== 'partial_answer'
  ) {
    throw new Error(`Subrun answer index points to ${message.type}`);
  }
  if (params.completionReason === undefined && message.type !== 'final_answer') {
    throw new Error(`Subrun answer ${answer.answerId} received chunks after it was sealed`);
  }
  const type = params.completionReason === undefined
    ? 'final_answer'
    : resolveAnswerSegmentMessageType(params.completionReason);
  const metadataInput = {
    ...message.metadata,
    answer_id: answer.answerId,
    turn_id: answer.turnId,
    run_id: state.subrunId,
    is_complete: answer.isComplete,
    ...(params.lastSeq !== undefined ? { last_seq: params.lastSeq } : {}),
    ...(params.sealSourceEventId
      ? { seal_source_event_id: params.sealSourceEventId }
      : {}),
    ...(params.completionReason ? { completion_reason: params.completionReason } : {}),
    activity: buildSubrunActivityBinding(state.subrunId),
  };
  const common = {
    ...message,
    content: answer.content,
    timestamp: params.timestamp,
    citationDependencies: projectMessageCitationDependencies(
      state.citationWorkspace,
      answer.turnId,
      answer.content,
    ),
  };
  let nextMessage: AnswerMessage;
  switch (type) {
    case 'final_answer':
      nextMessage = {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
    case 'tool_preamble':
      nextMessage = {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
    case 'partial_answer':
      nextMessage = {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
      break;
  }
  messages[index] = nextMessage;
}

export function projectSubrunTraceEvent(
  state: SubrunMessageProjectionState,
  messages: BaseMessage[],
  event: SSESubRunTraceEvent,
  _eventIndex?: number,
): SubrunTraceProjectionResult {
  const subrunId = event.subrun_id;
  if (state.subrunId !== subrunId) resetSubrunMessageProjection(state, messages, subrunId);

  if (event.kind === 'history_summary') {
    if (
      event.original_message_count === undefined
      || event.replaced_message_ids === undefined
    ) {
      return {
        success: false,
        reason: 'history_summary 缺少原始消息数或替换目标',
      };
    }
    messages.push({
      id: conversationSubrunMessageIdFromSummaryIdentity(
        subrunId,
        event.source_event_id,
      ),
      role: 'system',
      type: 'history_summary',
      // parent trace 是展示 read model，不复制 child 摘要正文；现有 SummaryMessage 只读取状态统计。
      content: '',
      timestamp: event.timestamp,
      metadata: {
        turn_id: event.turn_id,
        run_id: subrunId,
        summary: {
          info: {
            originalMessageCount: event.original_message_count,
            compressedMessageCount: 1,
            ...(event.compression_ratio === undefined
              ? {}
              : { compressionRatio: event.compression_ratio }),
          },
          replacedMessageIds: [...event.replaced_message_ids],
          ...(event.included_old_summary === undefined
            ? {}
            : { includedOldSummary: event.included_old_summary }),
        },
      },
    });
    return { success: true };
  }

  if (event.kind === 'tool_call_decision') {
    if (!Array.isArray(event.tool_calls) || event.tool_calls.length === 0) {
      return { success: false, reason: 'tool_call_decision 缺少 canonical tool_calls' };
    }
    for (const call of event.tool_calls) {
      const toolName = readString(call.tool_name);
      const toolCallId = readString(call.tool_call_id);
      if (!toolName || !toolCallId || !isRecord(call.args)) {
        return { success: false, reason: 'tool_call_decision 包含非法工具身份或参数' };
      }
      if (state.toolDecisionByCallId.has(toolCallId)) {
        return { success: false, reason: `tool_call_decision 重复声明 ${toolCallId}` };
      }
      state.toolDecisionByCallId.set(toolCallId, {
        toolName,
        args: call.args,
        turnId: event.turn_id,
        timestamp: event.timestamp,
      });
    }
    return { success: true };
  }
  if (event.kind === 'tool_process' || event.kind === 'tool_output') {
    const toolName = readString(event.tool_name);
    const toolCallId = readString(event.tool_call_id);
    if (!toolName || !toolCallId) {
      return {
        success: false,
        reason: `${event.kind} 缺少正式 tool_name 或 tool_call_id`,
      };
    }
    const status = normalizeToolStatus(event.status);
    if (!status) {
      return {
        success: false,
        reason: `${event.kind} 缺少正式 status`,
      };
    }
    if (event.kind === 'tool_process') {
      if (!isRecord(event.args)) {
        return { success: false, reason: `tool_process ${toolCallId} 缺少 owner-admitted args` };
      }
      const decision = state.toolDecisionByCallId.get(toolCallId);
      if (!decision || decision.toolName !== toolName || decision.turnId !== event.turn_id) {
        return { success: false, reason: `tool_process ${toolCallId} 与 durable decision 身份冲突` };
      }
      commitToolMessage(state, messages, {
        toolCallId,
        patch: createProcessPatch(toolName, status, event.args),
        timestamp: event.timestamp,
        turnId: event.turn_id,
      });
    } else {
      applyToolOutput(state, messages, {
        toolName,
        toolCallId,
        status,
        output: event.output,
        attachments: mapRuntimeAttachmentsToConversation(event.attachments),
        timestamp: event.timestamp,
        turnId: event.turn_id,
      });
    }
    return { success: true };
  }
  if (event.kind === 'thought_delta') {
    upsertThought(state, messages, {
      delta: event.delta,
      isComplete: false,
      timestamp: event.timestamp,
      turnId: event.turn_id,
    });
    return { success: true };
  }
  if (event.kind === 'thought_complete') {
    upsertThought(state, messages, {
      content: event.content,
      isComplete: true,
      timestamp: event.timestamp,
      turnId: event.turn_id,
    });
    return { success: true };
  }
  if (event.kind === 'final_answer_chunk') {
    const answerId = readString(event.answer_id);
    const seq = readNumber(event.seq);
    const delta = typeof event.delta === 'string' ? event.delta : undefined;
    if (!answerId || seq === undefined || !Number.isInteger(seq) || seq < 0 || delta === undefined) {
      return { success: false, reason: 'final_answer_chunk is missing answer identity, seq or delta' };
    }
    const answer = ensureSubrunAnswerState(state, answerId, event.turn_id);
    if (!answer) {
      return {
        success: false,
        reason: `answer ${event.answer_id} changed turn ownership`,
      };
    }
    applyAnswerSegmentChunk(answer, seq, delta);
    answer.isComplete = event.is_last === true;
    updateSubrunAnswerMessage(state, messages, answer, {
      timestamp: event.timestamp,
      lastSeq: seq,
    });
    return { success: true };
  }
  if (event.kind === 'final_answer') {
    const answerId = readString(event.answer_id);
    const content = typeof event.content === 'string' ? event.content : undefined;
    const completionReason = event.completion_reason;
    if (!answerId || content === undefined || completionReason === undefined) {
      return {
        success: false,
        reason: 'final_answer is missing answer identity, content or completion reason',
      };
    }
    const answer = state.answerStateById.get(answerId);
    if (!answer) {
      return isBlankAnswerContent(content)
        ? { success: true }
        : {
            success: false,
            reason: `final_answer ${event.answer_id} arrived without a chunk stream`,
          };
    }
    if (answer.turnId !== event.turn_id) {
      return {
        success: false,
        reason: `final_answer ${event.answer_id} changed turn ownership`,
      };
    }
    if (answer.content !== content) {
      return {
        success: false,
        reason: `final_answer ${event.answer_id} does not match its chunk stream`,
      };
    }
    answer.isComplete = completionReason !== 'interrupted';
    updateSubrunAnswerMessage(state, messages, answer, {
      timestamp: event.timestamp,
      sealSourceEventId: event.source_event_id,
      completionReason,
    });
    return { success: true };
  }
  return { success: true };
}
