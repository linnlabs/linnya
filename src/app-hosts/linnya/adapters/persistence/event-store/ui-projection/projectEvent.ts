import { shouldReplayRuntimeEventToUi } from '@linnlabs/linnkit/runtime-kernel/events';
import {
  type HistorySummaryEvent,
  type RunExecutionOutcome,
  parseRuntimeEventRoutingIdentity,
  type RuntimeEvent,
  type SerializableJsonRecord,
  type ToolCallDecisionEvent,
  type ToolOutputEvent,
  type ToolProcessEvent,
  toSerializableJsonRecord,
} from '@linnlabs/linnkit/contracts';
import {
  appendSubrunTraceSummary,
  ConversationActivityBindingSchema,
  ConversationPartialAnswerPayloadSchema,
  ConversationTerminalAnswerPayloadSchema,
  ConversationThoughtMessagePayloadSchema,
  ConversationToolPreamblePayloadSchema,
  ConversationToolMessagePayloadSchema,
  ConversationHistorySummaryPayloadSchema,
  ConversationUserMessagePayloadSchema,
  ConversationUiPresentationSchema,
  conversationMessageIdFromToolIdentity,
  projectConversationContextUsage,
  type ConversationAgentWorkOutcome,
  type ConversationUiPresentation,
} from '@app/schemas';
import {
  compactRecord,
  isRecord,
  readNonEmptyString,
  readRecordField,
  toSerializableValue,
} from './json';
import {
  buildInitialToolPayload,
  buildToolContentFromPatch,
  parseToolCallArguments,
  patchToolPayload,
  readToolCallsFromPayload,
  type ToolProjectionPatch,
} from './toolProjection';
import type {
  NewUiMessageRow,
  NewUiMessageRowInput,
  UiMessageRow,
  UiProjectionReadAccess,
  UiRowOp,
} from './types';
import { mapRuntimeAttachmentsToUi } from './attachments';

export function projectEventToUiRowOps(
  event: RuntimeEvent,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  if (!shouldReplayRuntimeEventToUi(event)) {
    return [skip(event, 'event-governance-replay-disabled')];
  }

  switch (event.type) {
    case 'user_input':
      return projectUserInput(event);
    case 'thought':
      return projectThought(event, access);
    case 'final_answer':
      return projectFinalAnswer(event, access);
    case 'tool_call_decision':
      return projectToolLifecycle(event, access);
    case 'tool_process':
      return projectToolLifecycle(event, access);
    case 'tool_output':
      return projectToolOutput(event, access);
    case 'subrun_trace':
      return projectSubrunTrace(event, access);
    case 'run_execution_metrics':
      return projectRunExecutionMetrics(event, access);
    case 'history_summary':
      return projectHistorySummary(event);
    case 'requires_user_interaction':
      return projectRequiresUserInteraction(event, access);
    case 'error':
      return [skip(event, 'error-event-is-surface-state-not-timeline-row')];
    default:
      return [skip(event, 'unsupported-runtime-event-type')];
  }
}

function projectUserInput(event: Extract<RuntimeEvent, { type: 'user_input' }>): UiRowOp[] {
  const presentation = readUiPresentation(event.metadata);
  if (presentation === 'hidden') {
    return [skip(event, 'user-input-hidden-presentation')];
  }

  const payload = ConversationUserMessagePayloadSchema.parse(compactRecord({
    user_quote: event.metadata?.user_quote,
    activity: readActivityBinding(event.metadata),
    extension: event.metadata?.extension,
  }));

  return [{
    op: 'insert',
    row: buildRow(event, {
      messageId: event.id,
      role: 'user',
      messageType: 'user_input',
      content: event.raw_content ?? event.content,
      attachments: mapRuntimeAttachmentsToUi(event.attachments),
      payload: Object.keys(payload).length > 0 ? payload : null,
      mergeKey: null,
      presentation,
    }),
  }];
}

function projectThought(
  event: Extract<RuntimeEvent, { type: 'thought' }>,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const mergeKey = thoughtMergeKey(event);
  const previous = access.getRowByMergeKey(event.conversation_id, mergeKey);
  if (previous && previous.messageType !== 'thought') {
    throw new Error(`Thought merge key ${mergeKey} points to ${previous.messageType}`);
  }
  const previousPayload = previous?.payload ?? null;
  const startedAt = readNumber(previousPayload?.thought_started_at) ?? readNumber(event.metadata?.thought_started_at) ?? event.timestamp;
  const completedAt = event.is_complete ? readNumber(event.metadata?.thought_completed_at) ?? event.timestamp : undefined;
  const nextContent = event.content;
  if (!previous && nextContent.trim().length === 0) {
    return [skip(event, 'thought-empty-content')];
  }

  const payload = ConversationThoughtMessagePayloadSchema.parse(compactRecord({
    is_complete: event.is_complete,
    thought_started_at: startedAt,
    thought_completed_at: completedAt,
    activity: readActivityBinding(event.metadata),
  }));
  const next = buildRow(event, {
    messageId: previous?.messageId ?? event.thought_message_id ?? event.id,
    role: 'assistant',
    messageType: 'thought',
    content: nextContent,
    payload,
    mergeKey,
    presentation: previous?.presentation ?? null,
  });

  return previous ? [{ op: 'replace', row: preserveSortSeq(previous, next) }] : [{ op: 'insert', row: next }];
}

function projectFinalAnswer(
  event: Extract<RuntimeEvent, { type: 'final_answer' }>,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  if (event.content.trim().length === 0) {
    return [skip(event, 'final-answer-empty-content')];
  }
  if (event.completion_reason === undefined) {
    return [skip(event, 'final-answer-missing-completion-reason')];
  }

  const mergeKey = answerMergeKey(event.answer_id);
  const previous = access.getRowByMergeKey(event.conversation_id, mergeKey);
  if (previous && previous.messageType !== 'final_answer'
    && previous.messageType !== 'tool_preamble'
    && previous.messageType !== 'partial_answer') {
    throw new Error(`Answer merge key ${mergeKey} points to ${previous.messageType}`);
  }
  const payloadFields = compactRecord({
    answer_id: event.answer_id,
    is_complete: event.completion_reason !== 'interrupted',
    completion_reason: event.completion_reason,
    final_meta: event.meta ? toSerializableValue(event.meta) : undefined,
    first_token_at: readNumber(previous?.payload?.first_token_at) ?? event.timestamp,
    activity: readActivityBinding(event.metadata),
  });
  const common = {
    messageId: previous?.messageId ?? event.id,
    role: 'assistant' as const,
    content: event.content,
    mergeKey,
    presentation: previous?.presentation ?? null,
  };
  const next = event.completion_reason === 'terminal'
    ? buildRow(event, {
        ...common,
        messageType: 'final_answer',
        payload: ConversationTerminalAnswerPayloadSchema.parse(payloadFields),
      })
    : event.completion_reason === 'tool_call'
      ? buildRow(event, {
          ...common,
          messageType: 'tool_preamble',
          payload: ConversationToolPreamblePayloadSchema.parse(payloadFields),
        })
      : buildRow(event, {
          ...common,
          messageType: 'partial_answer',
          payload: ConversationPartialAnswerPayloadSchema.parse(payloadFields),
        });

  return previous ? [{ op: 'replace', row: preserveSortSeq(previous, next) }] : [{ op: 'insert', row: next }];
}

function projectToolLifecycle(
  event: ToolCallDecisionEvent | ToolProcessEvent,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const ops: UiRowOp[] = [];
  const primaryPatch = buildToolLifecyclePatch(event);
  ops.push(upsertToolRow(event, event.tool_call_id, primaryPatch, access));

  if (event.type === 'tool_call_decision') {
    const batchedToolCalls = readToolCallsFromPayload(event.payload);
    for (const call of batchedToolCalls) {
      if (call.id === event.tool_call_id) {
        continue;
      }
      const perCallPayload: SerializableJsonRecord = {
        args: parseToolCallArguments(call),
        tool_calls: [toSerializableValue(call)],
      };
      const perCallPatch: ToolProjectionPatch = {
        type: 'tool_call_decision',
        phase: event.phase,
        status: event.status,
        toolName: call.function.name,
        payload: perCallPayload,
        eventMetadata: event.metadata ?? null,
      };
      ops.push(upsertToolRow(event, call.id, perCallPatch, access));
    }
  }

  return ops;
}

function projectToolOutput(
  event: ToolOutputEvent,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const ops: UiRowOp[] = [];
  const patch: ToolProjectionPatch = {
    type: 'tool_output',
    phase: event.status === 'error' ? 'error' : 'complete',
    status: event.status,
    toolName: event.tool_name,
    observation: event.observation,
    data: event.data,
    error: event.error,
    errorCode: event.error_code,
    presentation: toSerializableJsonRecord(event.metadata?.presentation),
    eventMetadata: event.metadata ?? null,
  };
  ops.push(upsertToolRow(event, event.tool_call_id, patch, access));

  return ops;
}

function projectRequiresUserInteraction(
  event: Extract<RuntimeEvent, { type: 'requires_user_interaction' }>,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const toolRow = access.getRowByMergeKey(
    event.conversation_id,
    toolMergeKey(readRunId(event), event.tool_call_id),
  );
  if (!toolRow) {
    return [skip(event, `interaction-parent-tool-not-found:${event.tool_call_id}`)];
  }
  if (toolRow.messageType !== 'tool_calls') {
    throw new Error(`Tool merge key ${event.tool_call_id} points to ${toolRow.messageType}`);
  }
  const form = isRecord(event.form) ? event.form : null;
  const formData = form?.data;
  const formObservation = typeof form?.observation === 'string' ? form.observation : null;
  if (formData === undefined || !formObservation?.trim()) {
    throw new Error(`Interaction ${event.interaction_id} 缺少 canonical form data/observation`);
  }
  return [{
    op: 'replace',
    row: {
      ...toolRow,
      payload: ConversationToolMessagePayloadSchema.parse({
        ...toolRow.payload,
        data: formData,
        interaction: {
          status: 'active',
          interactionId: event.interaction_id,
          runId: event.run_id,
          checkpointRevision: event.checkpoint_revision,
          resumeToken: event.resume_token,
        },
      }),
      content: formObservation,
    },
  }];
}

function projectSubrunTrace(
  event: Extract<RuntimeEvent, { type: 'subrun_trace' }>,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const parent = access.getRowByMergeKey(
    event.conversation_id,
    toolMergeKey(readRunId(event), event.parent_tool_call_id),
  );
  if (!parent) {
    return [skip(event, `subrun-parent-tool-not-found:${event.parent_tool_call_id}`)];
  }
  if (parent.messageType !== 'tool_calls') {
    throw new Error(`Tool merge key ${event.parent_tool_call_id} points to ${parent.messageType}`);
  }

  const payload = { ...parent.payload };
  const summary = appendSubrunTraceSummary(payload.subrun_summary, event.subrun_id);
  payload.subrun_summary = {
    subrun_ids: [...summary.subrun_ids],
    event_counts: { ...summary.event_counts },
  };

  return [{
    op: 'replace',
    row: {
      ...parent,
      payload: ConversationToolMessagePayloadSchema.parse(payload),
    },
  }];
}

function projectRunExecutionMetrics(
  event: Extract<RuntimeEvent, { type: 'run_execution_metrics' }>,
  access: UiProjectionReadAccess,
): UiRowOp[] {
  const durationMs = event.duration_ms;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return [skip(event, 'run-execution-metrics-without-valid-duration')];
  }

  const userMessageId = readNonEmptyString(event.user_message_id);
  if (!userMessageId) {
    return [skip(event, 'run-execution-metrics-without-user-message-id')];
  }

  const row = access.getRowByMessageId(event.conversation_id, userMessageId);
  if (!row || row.messageType !== 'user_input') {
    return [skip(event, `run-execution-metrics-user-message-not-found:${userMessageId}`)];
  }

  return [{
    op: 'replace',
    row: {
      ...row,
      payload: ConversationUserMessagePayloadSchema.parse({
        ...(row.payload ?? {}),
        agent_work: {
          duration_ms: durationMs,
          ended_at: event.timestamp,
          outcome: mapRunExecutionOutcome(event.outcome),
        },
        ...(event.context_usage
          ? { context_usage: projectConversationContextUsage(event.context_usage) }
          : {}),
      }),
    },
  }];
}

function projectHistorySummary(event: HistorySummaryEvent): UiRowOp[] {
  const payload = ConversationHistorySummaryPayloadSchema.parse({
    summary: {
      info: {
        originalMessageCount: event.original_message_count,
        compressedMessageCount: 1,
        ...(event.compression_ratio === undefined
          ? {}
          : { compressionRatio: event.compression_ratio }),
      },
      replacedMessageIds: event.replaced_message_ids,
      ...(event.included_old_summary === undefined
        ? {}
        : { includedOldSummary: event.included_old_summary }),
    },
  });
  const row = buildRow(event, {
    messageId: event.id,
    role: 'system',
    messageType: 'history_summary',
    content: event.content,
    payload,
    mergeKey: summaryMergeKey(event.id),
    presentation: null,
  });

  return [
    { op: 'insert', row },
    { op: 'hide', messageIds: event.replaced_message_ids },
  ];
}

function upsertToolRow(
  event: ToolCallDecisionEvent | ToolProcessEvent | ToolOutputEvent,
  toolCallId: string,
  patch: ToolProjectionPatch,
  access: UiProjectionReadAccess,
): UiRowOp {
  const messageId = conversationMessageIdFromToolIdentity(readRunId(event), toolCallId);
  const mergeKey = toolMergeKey(readRunId(event), toolCallId);
  const previous = access.getRowByMergeKey(event.conversation_id, mergeKey);
  if (previous && previous.messageType !== 'tool_calls') {
    throw new Error(`Tool merge key ${mergeKey} points to ${previous.messageType}`);
  }
  const basePayload = previous?.payload ?? buildInitialToolPayload(toolCallId, patch, event.timestamp);
  const nextPayload = ConversationToolMessagePayloadSchema.parse(
    patchToolPayload(basePayload, patch, event.timestamp),
  );
  const content = buildToolContentFromPatch(patch);
  const next = buildRow(event, {
    messageId: previous?.messageId ?? messageId,
    role: 'assistant',
    messageType: 'tool_calls',
    content: content ?? previous?.content ?? '',
    attachments: event.type === 'tool_output'
      ? mapRuntimeAttachmentsToUi(event.attachments)
      : previous?.attachments,
    payload: nextPayload,
    mergeKey,
    presentation: null,
  });

  return previous ? { op: 'replace', row: preserveSortSeq(previous, next) } : { op: 'insert', row: next };
}

function buildToolLifecyclePatch(event: ToolCallDecisionEvent | ToolProcessEvent): ToolProjectionPatch {
  const payload: SerializableJsonRecord = { ...(event.payload ?? {}) };
  if (event.args !== undefined) {
    payload.args = event.args;
  }

  return {
    type: event.type,
    phase: event.phase,
    status: event.status,
    toolName: event.tool_name,
    payload,
    eventMetadata: event.metadata ?? null,
  };
}

function buildRow(
  event: RuntimeEvent,
  input: NewUiMessageRowInput,
): NewUiMessageRow {
  const common = {
    attachments: input.attachments ?? null,
    conversationId: event.conversation_id,
    turnId: event.turn_id,
    timestamp: event.timestamp,
    runId: readRunId(event),
  };
  // switch 不是展示分支，而是让 TypeScript 保留 role/type/payload 三者的关联。
  switch (input.messageType) {
    case 'user_input':
      return { ...input, ...common };
    case 'thought':
      return { ...input, ...common };
    case 'tool_calls':
      return { ...input, ...common };
    case 'final_answer':
      return { ...input, ...common };
    case 'tool_preamble':
      return { ...input, ...common };
    case 'partial_answer':
      return { ...input, ...common };
    case 'history_summary':
      return { ...input, ...common };
  }
}

function preserveSortSeq(previous: UiMessageRow, next: NewUiMessageRow): UiMessageRow {
  return {
    ...next,
    sortSeq: previous.sortSeq,
  };
}

function skip(event: RuntimeEvent, reason: string): UiRowOp {
  return {
    op: 'skip',
    eventType: event.type,
    eventId: event.id,
    reason,
  };
}

function readRunId(event: RuntimeEvent): string {
  return parseRuntimeEventRoutingIdentity(event).run_id;
}

function readUiPresentation(metadata: SerializableJsonRecord | undefined): ConversationUiPresentation | null {
  const ui = readRecordField(metadata, 'ui');
  const value = ui?.presentation;
  if (value === undefined) return null;
  const parsed = ConversationUiPresentationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid conversation UI presentation: ${String(value)}`);
  }
  return parsed.data;
}

function readActivityBinding(
  metadata: SerializableJsonRecord | undefined,
): ReturnType<typeof ConversationActivityBindingSchema.parse> | undefined {
  if (metadata?.activity === undefined) return undefined;
  return ConversationActivityBindingSchema.parse(metadata.activity);
}

function mapRunExecutionOutcome(outcome: RunExecutionOutcome): ConversationAgentWorkOutcome {
  switch (outcome) {
    case 'completed':
    case 'awaiting_user':
    case 'failed':
    case 'cancelled':
      return outcome;
  }
}

function thoughtMergeKey(event: Extract<RuntimeEvent, { type: 'thought' }>): string {
  return `thought:${event.thought_message_id ?? event.turn_id}`;
}

function answerMergeKey(answerId: string): string {
  return `answer:${answerId}`;
}

function toolMergeKey(runId: string, toolCallId: string): string {
  return conversationMessageIdFromToolIdentity(runId, toolCallId);
}

function summaryMergeKey(summaryId: string): string {
  return `summary:${summaryId}`;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
