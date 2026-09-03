import {
  SerializableJsonRecord,
  ToolCallWire,
  type RoutedRuntimeEvent,
  type SubRunTraceToolCallDecision,
} from '../../contracts';
import type { SubRunTraceEnvelope } from './subrunTrace.types';

/**
 * parent trace 是 child fact 的展示投影。该函数只做语义选择与字段映射，
 * 不拥有 child admission、parent 发布、持久化或事件 ID。
 */
export function projectChildRuntimeEventToSubRunTrace(
  event: RoutedRuntimeEvent,
): SubRunTraceEnvelope | null {
  switch (event.type) {
    case 'thought':
      return event.is_complete
        ? {
            kind: 'thought_complete',
            source_event_id: event.id,
            content: event.content,
          }
        : {
            kind: 'thought_delta',
            source_event_id: event.id,
            delta: event.delta ?? event.content,
          };
    case 'tool_call_decision':
      return {
        kind: 'tool_call_decision',
        source_event_id: event.id,
        tool_calls: readDecisionBatch(event),
      };
    case 'tool_process':
      if (event.args === undefined) {
        throw new Error(`[SubrunTrace] tool_process ${event.id} 缺少 owner-admitted args`);
      }
      return {
        kind: event.type,
        source_event_id: event.id,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        phase: event.phase,
        status: event.status,
        args: event.args,
      };
    case 'tool_output':
      if (event.status === 'success') {
        return {
          kind: 'tool_output',
          source_event_id: event.id,
          tool_name: event.tool_name,
          tool_call_id: event.tool_call_id,
          status: 'success',
          output: {
            data: event.data ?? null,
            observation: event.observation,
            ...(typeof event.metadata?.presentation === 'object'
              && event.metadata.presentation !== null
              && !Array.isArray(event.metadata.presentation)
              ? event.metadata.presentation
              : {}),
          },
          ...(event.attachments === undefined ? {} : { attachments: event.attachments }),
          ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
        };
      }
      return {
        kind: 'tool_output',
        source_event_id: event.id,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        status: 'error',
        output: {
          observation: event.observation,
          ...(event.error === undefined ? {} : { error: event.error }),
        },
        ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
      };
    case 'final_answer_chunk':
      return {
        kind: 'final_answer_chunk',
        source_event_id: event.id,
        answer_id: event.answer_id,
        seq: event.seq,
        delta: event.content,
        ...(event.is_last === undefined ? {} : { is_last: event.is_last }),
      };
    case 'final_answer':
      return {
        kind: 'final_answer',
        source_event_id: event.id,
        answer_id: event.answer_id,
        content: event.content,
        completion_reason: event.completion_reason,
      };
    case 'history_summary':
      return {
        kind: 'history_summary',
        source_event_id: event.id,
        original_message_count: event.original_message_count,
        replaced_message_ids: event.replaced_message_ids,
        ...(event.compression_ratio === undefined
          ? {}
          : { compression_ratio: event.compression_ratio }),
        ...(event.included_old_summary === undefined
          ? {}
          : { included_old_summary: event.included_old_summary }),
      };
    default:
      return null;
  }
}

function readDecisionBatch(
  event: Extract<RoutedRuntimeEvent, { type: 'tool_call_decision' }>,
): SubRunTraceToolCallDecision[] {
  const rawCalls = event.payload?.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    throw new Error(`[SubrunTrace] tool_call_decision ${event.id} 缺少 canonical tool_calls`);
  }
  return rawCalls.map((rawCall, index) => {
    const call = ToolCallWire.parse(rawCall, { path: ['payload', 'tool_calls', index] });
    let decodedArgs: unknown;
    try {
      decodedArgs = JSON.parse(call.function.arguments);
    } catch {
      throw new Error(`[SubrunTrace] tool_call_decision ${call.id} arguments 不是合法 JSON`);
    }
    return {
      tool_call_id: call.id,
      tool_name: call.function.name,
      args: SerializableJsonRecord.parse(decodedArgs, {
        path: ['payload', 'tool_calls', index, 'function', 'arguments'],
      }),
    };
  });
}
