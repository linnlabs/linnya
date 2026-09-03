import {
  RuntimeEvent,
  type SerializableJsonRecord,
  type SerializableJsonValue,
  type SubRunTraceEvent,
} from 'linnkit/contracts';
import type {
  DurableSubrunTraceEvent,
  DurableSubrunTraceKind,
} from '../definitions/subrunTraceHistory';

export interface StoredSubrunTraceHistoryPayload {
  readonly content?: string;
  readonly answer_id?: string;
  readonly completion_reason?: SubRunTraceEvent['completion_reason'];
  readonly tool_name?: string;
  readonly tool_call_id?: string;
  readonly phase?: SubRunTraceEvent['phase'];
  readonly status?: SubRunTraceEvent['status'];
  readonly args?: SerializableJsonValue;
  readonly tool_calls?: SubRunTraceEvent['tool_calls'];
  readonly output?: SerializableJsonValue;
  readonly attachments?: SubRunTraceEvent['attachments'];
  readonly duration_ms?: number;
  readonly original_message_count?: number;
  readonly compression_ratio?: number;
  readonly included_old_summary?: boolean;
  readonly replaced_message_ids?: SubRunTraceEvent['replaced_message_ids'];
  readonly meta?: SerializableJsonRecord;
}

export function isDurableSubrunTraceEvent(
  event: SubRunTraceEvent
): event is DurableSubrunTraceEvent {
  return (
    event.kind === 'thought_complete' ||
    event.kind === 'tool_call_decision' ||
    event.kind === 'tool_output' ||
    event.kind === 'final_answer' ||
    event.kind === 'history_summary'
  );
}

export function encodeSubrunTraceHistoryPayload(
  event: DurableSubrunTraceEvent
): StoredSubrunTraceHistoryPayload {
  switch (event.kind) {
    case 'thought_complete':
      return event.content === undefined ? {} : { content: event.content };
    case 'tool_call_decision':
      return {
        tool_calls: event.tool_calls,
      };
    case 'tool_output':
      return {
        ...(event.tool_name === undefined ? {} : { tool_name: event.tool_name }),
        ...(event.tool_call_id === undefined ? {} : { tool_call_id: event.tool_call_id }),
        ...(event.status === undefined ? {} : { status: event.status }),
        ...(event.output === undefined ? {} : { output: event.output }),
        ...(event.attachments === undefined ? {} : { attachments: event.attachments }),
        ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
      };
    case 'final_answer':
      return {
        ...(event.answer_id === undefined ? {} : { answer_id: event.answer_id }),
        ...(event.content === undefined ? {} : { content: event.content }),
        ...(event.completion_reason === undefined
          ? {}
          : { completion_reason: event.completion_reason }),
      };
    case 'history_summary':
      return {
        ...(event.original_message_count === undefined
          ? {}
          : { original_message_count: event.original_message_count }),
        ...(event.compression_ratio === undefined
          ? {}
          : { compression_ratio: event.compression_ratio }),
        ...(event.included_old_summary === undefined
          ? {}
          : { included_old_summary: event.included_old_summary }),
        ...(event.replaced_message_ids === undefined
          ? {}
          : { replaced_message_ids: event.replaced_message_ids }),
      };
  }
}

export function decodeSubrunTraceHistoryEvent(input: {
  readonly itemId: number;
  readonly conversationId: string;
  readonly turnId: string;
  readonly parentRunId: string | null;
  readonly parentToolCallId: string;
  readonly subrunId: string;
  readonly subrunParentId: string | null;
  readonly sourceEventId: string;
  readonly kind: DurableSubrunTraceKind;
  readonly timestamp: number;
  readonly payloadJson: string;
}): SubRunTraceEvent {
  const payload: unknown = JSON.parse(input.payloadJson);
  const parsed = RuntimeEvent.parse({
    id: `subrun-history-${input.itemId}`,
    type: 'subrun_trace',
    conversation_id: input.conversationId,
    turn_id: input.turnId,
    timestamp: input.timestamp,
    version: 1,
    ephemeral: true,
    ...(input.parentRunId === null ? {} : { run_id: input.parentRunId }),
    parent_tool_call_id: input.parentToolCallId,
    subrun_id: input.subrunId,
    ...(input.subrunParentId === null ? {} : { subrun_parent_id: input.subrunParentId }),
    source_event_id: input.sourceEventId,
    kind: input.kind,
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
  });
  if (parsed.type !== 'subrun_trace') {
    throw new Error('[SubrunTraceHistory] reconstructed item is not a subrun_trace event');
  }
  return parsed;
}
