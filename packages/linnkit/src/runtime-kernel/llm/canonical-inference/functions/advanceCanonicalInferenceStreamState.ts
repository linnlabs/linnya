import type { CanonicalInferenceEvent, ProviderContinuation } from '../../../../ports';
import type {
  CanonicalInferenceStreamState,
  OpenCanonicalToolCall,
} from '../definitions/canonicalInferenceStreamState';

function requireStreaming(state: CanonicalInferenceStreamState, eventType: string): void {
  if (state.phase !== 'streaming') {
    throw new Error(`[CanonicalInference] ${eventType} 只能出现在 start 与 terminal 之间。`);
  }
}

function requireOpenTool(
  state: CanonicalInferenceStreamState,
  index: number
): OpenCanonicalToolCall {
  const openToolCall = state.open_tool_calls.find(call => call.index === index);
  if (!openToolCall) {
    throw new Error(`[CanonicalInference] tool index ${index} 尚未开始或已经结束。`);
  }
  return openToolCall;
}

function assertContinuation(value: ProviderContinuation): void {
  for (const [field, current] of Object.entries(value.producer)) {
    if (!current.trim()) {
      throw new Error(`[CanonicalInference] continuation producer.${field} 不能为空。`);
    }
  }
  if (!value.kind.trim()) throw new Error('[CanonicalInference] continuation kind 不能为空。');
}

function requireNewAssistantPartIndex(
  state: CanonicalInferenceStreamState,
  index: number
): void {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('[CanonicalInference] assistant part index 必须是非负安全整数。');
  }
  if (state.assistant_part_indices.includes(index)) {
    throw new Error(`[CanonicalInference] assistant part index ${index} 重复。`);
  }
}

export function advanceCanonicalInferenceStreamState(
  state: CanonicalInferenceStreamState,
  event: CanonicalInferenceEvent
): CanonicalInferenceStreamState {
  if (state.phase === 'terminal') {
    throw new Error(`[CanonicalInference] terminal 后不能再出现 ${event.type}。`);
  }
  if (event.type === 'start') {
    if (state.phase !== 'idle') {
      throw new Error('[CanonicalInference] 每个 attempt 必须且只能产生一个 start。');
    }
    if (!event.model_id.trim() || !event.attempt_id.trim()) {
      throw new Error('[CanonicalInference] start 必须包含 model_id 和 attempt_id。');
    }
    return { ...state, phase: 'streaming' };
  }

  requireStreaming(state, event.type);
  switch (event.type) {
    case 'answer_delta':
    case 'thought_delta':
      if (!event.text) throw new Error(`[CanonicalInference] ${event.type} 不能为空。`);
      return state;
    case 'tool_call_start':
      if (!Number.isSafeInteger(event.index) || event.index < 0) {
        throw new Error('[CanonicalInference] tool index 必须是非负安全整数。');
      }
      if (state.open_tool_calls.some(call => call.index === event.index)) {
        throw new Error(`[CanonicalInference] tool index ${event.index} 重复开始。`);
      }
      requireNewAssistantPartIndex(state, event.part_index);
      if (event.id !== undefined && !event.id.trim()) {
        throw new Error('[CanonicalInference] tool_call_start.id 不能是空字符串。');
      }
      if (event.name !== undefined && !event.name.trim()) {
        throw new Error('[CanonicalInference] tool_call_start.name 不能是空字符串。');
      }
      return {
        ...state,
        open_tool_calls: [
          ...state.open_tool_calls,
          { index: event.index, part_index: event.part_index, id: event.id, name: event.name },
        ],
        assistant_part_indices: [...state.assistant_part_indices, event.part_index],
      };
    case 'tool_argument_delta':
      requireOpenTool(state, event.index);
      if (!event.json_delta) {
        throw new Error('[CanonicalInference] tool_argument_delta.json_delta 不能为空。');
      }
      return state;
    case 'tool_call_end': {
      const openToolCall = requireOpenTool(state, event.index);
      if (!event.call.id.trim() || !event.call.name.trim()) {
        throw new Error('[CanonicalInference] 完整工具调用必须包含 id 和 name。');
      }
      if (openToolCall.id !== undefined && openToolCall.id !== event.call.id) {
        throw new Error(`[CanonicalInference] tool index ${event.index} 的 id 前后不一致。`);
      }
      if (openToolCall.name !== undefined && openToolCall.name !== event.call.name) {
        throw new Error(`[CanonicalInference] tool index ${event.index} 的 name 前后不一致。`);
      }
      event.call.continuation?.forEach(assertContinuation);
      return {
        ...state,
        open_tool_calls: state.open_tool_calls.filter(call => call.index !== event.index),
      };
    }
    case 'assistant_part_end':
      requireNewAssistantPartIndex(state, event.index);
      if (event.part.type === 'text' && !event.part.text) {
        throw new Error('[CanonicalInference] text assistant part 不能为空。');
      }
      event.part.continuation?.forEach(assertContinuation);
      return {
        ...state,
        assistant_part_indices: [...state.assistant_part_indices, event.index],
      };
    case 'usage':
      if (state.usage_seen) {
        throw new Error('[CanonicalInference] 每个 attempt 最多产生一个 usage。');
      }
      if (event.usage.source !== 'provider-response-usage' || event.usage.confidence !== 'actual') {
        throw new Error('[CanonicalInference] usage 事件只能承载 Provider 已上报的 actual usage。');
      }
      return { ...state, usage_seen: true };
    case 'finish':
      if (state.open_tool_calls.length > 0) {
        throw new Error('[CanonicalInference] 工具调用未结束时不能 finish。');
      }
      return { ...state, phase: 'terminal', terminal: event };
    case 'failure':
      if (!event.code.trim()) throw new Error('[CanonicalInference] failure.code 不能为空。');
      return { ...state, phase: 'terminal', terminal: event };
  }
}
