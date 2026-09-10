import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';

import type { LlmStreamAuditEvent } from '../definitions/llmEvidence';

/**
 * 把 Provider-independent canonical stream event 投影为最高审计等级允许持久化的形状。
 *
 * continuation 与 rawUsage 可能携带 Provider 私有数据，必须在这里明确丢弃；调用方不能
 * 直接把整个 canonical event 交给 AuditPort。
 */
export function projectCanonicalInferenceStreamAuditEvent(
  event: CanonicalInferenceEvent
): LlmStreamAuditEvent {
  switch (event.type) {
    case 'start':
      return { type: event.type, modelId: event.model_id, attemptId: event.attempt_id };
    case 'answer_delta':
    case 'thought_delta':
      return { type: event.type, text: event.text };
    case 'tool_call_start':
      return {
        type: event.type,
        index: event.index,
        partIndex: event.part_index,
        ...(event.id === undefined ? {} : { id: event.id }),
        ...(event.name === undefined ? {} : { name: event.name }),
      };
    case 'tool_argument_delta':
      return { type: event.type, index: event.index, jsonDelta: event.json_delta };
    case 'tool_call_end':
      return {
        type: event.type,
        index: event.index,
        call: {
          id: event.call.id,
          name: event.call.name,
          arguments: event.call.arguments,
        },
      };
    case 'assistant_part_end':
      return {
        type: event.type,
        index: event.index,
        part: {
          type: event.part.type,
          text: event.part.text,
        },
      };
    case 'usage':
      return {
        type: event.type,
        usage: {
          ...(event.usage.inputTokens === undefined
            ? {}
            : { inputTokens: event.usage.inputTokens }),
          ...(event.usage.outputTokens === undefined
            ? {}
            : { outputTokens: event.usage.outputTokens }),
          ...(event.usage.reasoningTokens === undefined
            ? {}
            : { reasoningTokens: event.usage.reasoningTokens }),
          ...(event.usage.totalTokens === undefined
            ? {}
            : { totalTokens: event.usage.totalTokens }),
          source: event.usage.source,
          confidence: event.usage.confidence,
        },
      };
    case 'finish':
      return { type: event.type, reason: event.reason };
    case 'failure':
      return {
        type: event.type,
        kind: event.kind,
        code: event.code,
        retryable: event.retryable,
      };
  }
}
