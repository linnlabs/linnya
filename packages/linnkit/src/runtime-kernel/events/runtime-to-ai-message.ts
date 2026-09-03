import {
  ToolCallIdSchema,
  ToolCallWire as ToolCallWireSchema,
  type ToolCallWire,
} from '../../contracts';
import type {
  AiMessage,
  HistorySummaryEvent,
  ObservationTruncationMeta,
  RuntimeEvent,
  ToolCallDecisionEvent as RuntimeToolCallDecisionEvent,
  ToolOutputEvent as RuntimeToolOutputEvent,
} from '../../contracts';
import { type ConversationMemoryPort } from './provider-sidecar';

export function applyRuntimeEventToMemory(event: RuntimeEvent, memory: ConversationMemoryPort): void {
  switch (event.type) {
    case 'user_input': {
      memory.addUserMessage(event.content, event.id, event.attachments);
      break;
    }

    case 'tool_call_decision':
      applyToolCallDecision(event, memory);
      break;

    case 'tool_output':
      applyToolOutput(event, memory);
      break;

    case 'final_answer': {
      // tool_call 封口只服务 UI 的流式正文；同一次 Assistant 产出由随后的 tool_call_decision
      // 以完整 ordered replay parts 写入 Context，避免拆成两个 assistant turn。
      if (event.completion_reason === 'tool_call') break;
      if (event.content.trim()) {
        const metadata = {
          completion_reason: event.completion_reason,
          ...(event.provider_continuations
            ? { provider_continuations: event.provider_continuations }
            : {}),
          ...(event.assistant_replay_parts
            ? { assistant_replay_parts: event.assistant_replay_parts }
            : {}),
        };
        memory.addAssistantMessage(event.content, 'final_answer', metadata, event.id);
      }
      break;
    }

    case 'thought': {
      memory.addAssistantMessage(event.content, 'thought', undefined, event.id);
      break;
    }

    case 'history_summary':
      applyHistorySummary(event, memory);
      break;

    case 'error':
      break;

    default:
      break;
  }
}

/**
 * RuntimeEvent → AiMessage 的唯一纯投影入口。
 *
 * Context Manager 与内存重建必须共享同一套规则，尤其是 tool-call 封口合并和 ordered replay；
 * 分别维护 switch 会让 durable history 与 live memory 再次产生语义漂移。
 */
export function projectRuntimeEventToAiMessage(event: RuntimeEvent): AiMessage | null {
  let projected: AiMessage | null = null;
  const memory: ConversationMemoryPort = {
    addUserMessage(content, id, attachments) {
      projected = {
        id: id ?? event.id,
        role: 'user',
        type: 'user_input',
        content,
        timestamp: event.timestamp,
        ...(attachments ? { attachments } : {}),
      };
    },
    addAssistantMessage(content, type, metadata, id) {
      projected = {
        id: id ?? event.id,
        role: 'assistant',
        type,
        content: content ?? '',
        timestamp: event.timestamp,
        ...(metadata ? { metadata } : {}),
      };
    },
    addToolResponse(toolCallId, content, toolName, id, attachments, metadata) {
      projected = {
        id: id ?? event.id,
        role: 'tool',
        type: 'tool_output',
        content,
        timestamp: event.timestamp,
        metadata: {
          tool_call_id: ToolCallIdSchema.parse(toolCallId),
          tool_name: toolName,
          ...metadata,
        },
        ...(attachments ? { attachments } : {}),
      };
    },
    appendMessage(message) {
      projected = message;
    },
  };
  applyRuntimeEventToMemory(event, memory);
  return projected;
}

function applyToolCallDecision(event: RuntimeToolCallDecisionEvent, memory: ConversationMemoryPort): void {
  const payload = event.payload || {};
  const toolCalls: ToolCallWire[] = Array.isArray(payload.tool_calls)
    ? payload.tool_calls.map((toolCall) => ToolCallWireSchema.parse(toolCall))
    : [];
  const toolArgs = event.args || payload.args || {};

  const normalizedToolCalls: ToolCallWire[] = toolCalls.length > 0
    ? toolCalls
    : [{
        id: event.tool_call_id,
        type: 'function',
        function: { name: event.tool_name, arguments: JSON.stringify(toolArgs || {}) },
      }];
  const providerContinuations = payload.provider_continuations;
  const assistantReplayParts = payload.assistant_replay_parts;
  const replayText = assistantReplayParts
    ?.filter(part => part.type === 'text')
    .map(part => part.text)
    .join('') ?? null;

  memory.addAssistantMessage(
    replayText,
    'tool_calls',
    {
      tool_calls: normalizedToolCalls,
      ...(providerContinuations ? { provider_continuations: providerContinuations } : {}),
      ...(assistantReplayParts ? { assistant_replay_parts: assistantReplayParts } : {}),
    },
    event.id,
  );
}

function applyToolOutput(event: RuntimeToolOutputEvent, memory: ConversationMemoryPort): void {
  const observationTruncation = readObservationTruncationMeta(
    event.metadata?.observationTruncation
  );
  memory.addToolResponse(
    event.tool_call_id,
    event.observation,
    event.tool_name,
    event.id,
    event.attachments,
    {
      ...(event.data !== undefined ? { data: event.data } : {}),
      ...(event.error !== undefined ? { error: event.error } : {}),
      ...(event.metadata?.presentation !== undefined
        ? { presentation: event.metadata.presentation }
        : {}),
      ...(observationTruncation ? { observationTruncation } : {}),
    },
  );
}

function readObservationTruncationMeta(value: unknown): ObservationTruncationMeta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const originalChars = Reflect.get(value, 'originalChars');
  const previewChars = Reflect.get(value, 'previewChars');
  if (typeof originalChars !== 'number' || !Number.isInteger(originalChars) || originalChars < 0) {
    return undefined;
  }
  if (typeof previewChars !== 'number' || !Number.isInteger(previewChars) || previewChars < 0) {
    return undefined;
  }
  const blobId = Reflect.get(value, 'blobId');
  const originalLines = Reflect.get(value, 'originalLines');
  const previewLines = Reflect.get(value, 'previewLines');
  return {
    ...(typeof blobId === 'string' && blobId.trim() ? { blobId: blobId.trim() } : {}),
    originalChars,
    previewChars,
    ...(typeof originalLines === 'number' && Number.isInteger(originalLines) && originalLines >= 0
      ? { originalLines }
      : {}),
    ...(typeof previewLines === 'number' && Number.isInteger(previewLines) && previewLines >= 0
      ? { previewLines }
      : {}),
  };
}

function applyHistorySummary(summaryEvent: HistorySummaryEvent, memory: ConversationMemoryPort): void {
  const summaryMetadata: AiMessage['metadata'] = {
    messageType: 'summary',
    originalMessageCount: summaryEvent.original_message_count,
    compressionRatio: summaryEvent.compression_ratio,
    includedOldSummary: summaryEvent.included_old_summary,
    replacedMessageIds: summaryEvent.replaced_message_ids,
    summarySeq: summaryEvent.summary_seq,
  };

  const summaryMessage: AiMessage = {
    id: summaryEvent.id,
    role: 'system',
    type: 'history_summary',
    content: summaryEvent.content,
    timestamp: summaryEvent.timestamp,
    metadata: summaryMetadata,
  };

  memory.appendMessage(summaryMessage);
}
